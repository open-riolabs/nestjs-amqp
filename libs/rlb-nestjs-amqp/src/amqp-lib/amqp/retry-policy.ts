import { Channel, ConsumeMessage, Options } from 'amqplib';
import { MessageDeserializationError } from '../models/errors.model';
import { MessageErrorHandler } from '../types';

/**
 * Retry policy for failed message processing. Replaces the legacy infinite
 * nack-requeue default: a failing message is re-published a bounded number of
 * times (optionally after a delay) and then dead-lettered or dropped, so a
 * poison message can never hot-loop a consumer forever.
 *
 * Configurable globally (`broker.retry`) and per topic (`topics[].retry`).
 */
export interface RetryPolicyConfig {
  /** Total processing attempts per message, including the first one (default 5). */
  maxAttempts?: number;
  /**
   * Wait between attempts, in ms (default 0 = immediate). Implemented with a
   * TTL wait-queue (`<queue>.retry.<delayMs>` + dead-letter back to the work
   * queue), so no consumer-side timers are involved.
   */
  delayMs?: number;
  /**
   * What to do once attempts are exhausted (default 'dead-letter' when
   * `deadLetter` is configured, 'drop' otherwise). Either way the message is
   * acked and an error is logged; 'dead-letter' also publishes a copy (with
   * diagnostic headers) to `deadLetter.exchange`.
   */
  onExhausted?: 'dead-letter' | 'drop';
  /**
   * Destination for exhausted messages. The exchange is NOT asserted here —
   * declare it in `broker.exchanges` (a missing exchange fails the dead-letter
   * publish and the message falls back to a single nack-requeue).
   */
  deadLetter?: {
    exchange: string;
    /** Defaults to the message's original routing key. */
    routingKey?: string;
  };
}

/** Attempts already made, stamped on every retry copy. */
export const RETRY_COUNT_HEADER = 'x-retry-count';
/** Diagnostic headers stamped on dead-lettered copies. */
export const RETRY_ERROR_HEADER = 'x-retry-error';
export const RETRY_ORIGIN_QUEUE_HEADER = 'x-retry-origin-queue';

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: 5,
  delayMs: 0,
  onExhausted: 'drop',
};

/**
 * Name of the error sent as the RPC reply when every attempt failed; the
 * gateway maps it to HTTP 502 so callers fail fast instead of burning the
 * full RPC timeout.
 */
export const RETRY_EXHAUSTED_ERROR = 'RetryExhaustedError';

/** The connection facilities the handler needs (implemented by AmqpConnection). */
export interface RetryPolicyContext {
  /** Publish through the confirm channel; resolves on broker confirm. */
  publish(exchange: string, routingKey: string, message: any, options?: Options.Publish): Promise<unknown>;
  /** Idempotently assert the TTL wait-queue that dead-letters back to `targetQueue`. */
  assertRetryWaitQueue(waitQueue: string, delayMs: number, targetQueue: string): Promise<void>;
  logger: { warn(msg: string): void; error(msg: string): void };
}

const errorToPlain = (error: any): { name: string; message: string } => ({
  name: (error && typeof error === 'object' && error.name) ? String(error.name) : 'Error',
  message: error?.message ?? String(error),
});

/**
 * Builds the MessageErrorHandler enforcing `policy` for messages of `queue`.
 *
 * Behavior on the Nth failure of a message:
 * - retriable and N < maxAttempts → ack the original and re-publish a copy
 *   (same properties, `x-retry-count: N`) to the work queue via the default
 *   exchange — immediately, or through the TTL wait-queue when `delayMs` > 0.
 * - exhausted, or a {@link MessageDeserializationError} (the message can never
 *   become valid — retrying is pointless) → if the message carries `replyTo`,
 *   an error reply is sent so a waiting RPC caller fails fast; then the copy
 *   is dead-lettered (or dropped) and the original is acked.
 * - any re-publish failure → single nack-requeue, so the message survives on
 *   the broker rather than being lost (at-least-once is preserved).
 *
 * Never throws: an error handler that throws inside the consume callback would
 * become an unhandled rejection and can crash the process.
 */
export function createRetryErrorHandler(
  queue: string,
  policy: RetryPolicyConfig,
  ctx: RetryPolicyContext,
): MessageErrorHandler {
  const maxAttempts = Math.max(1, policy.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts);
  const delayMs = policy.delayMs ?? DEFAULT_RETRY_POLICY.delayMs;
  const onExhausted = policy.onExhausted ?? (policy.deadLetter ? 'dead-letter' : 'drop');

  return async (channel: Channel, msg: ConsumeMessage, error: any): Promise<void> => {
    try {
      const attempts = Number(msg.properties.headers?.[RETRY_COUNT_HEADER] ?? 0) + 1;
      const retriable = !(error instanceof MessageDeserializationError);

      if (retriable && attempts < maxAttempts) {
        await scheduleRetry(msg, attempts);
        ctx.logger.warn(`[RETRY] queue '${queue}' attempt ${attempts}/${maxAttempts} failed (${error?.message}); retrying${delayMs > 0 ? ` in ${delayMs}ms` : ''}`);
      } else {
        await replyErrorToRpcCaller(msg, error, attempts);
        await exhaust(msg, error, attempts, retriable);
      }
      channel.ack(msg);
    } catch (republishError) {
      // The message could not be handed anywhere safe (broker publish failed):
      // keep it on the broker with a single requeue instead of losing it.
      ctx.logger.error(`[RETRY] queue '${queue}': could not re-publish/dead-letter message (${(republishError as Error)?.message}); falling back to nack-requeue`);
      try {
        channel.nack(msg, false, true);
      } catch (nackError) {
        // Channel died in the meantime: the unacked message is redelivered on reconnect anyway.
        ctx.logger.error(`[RETRY] queue '${queue}': nack failed (${(nackError as Error)?.message}); message will be redelivered on reconnect`);
      }
    }
  };

  /** Copy of the original properties with the incremented retry counter. */
  function retryProperties(msg: ConsumeMessage, attempts: number, extraHeaders?: Record<string, any>): Options.Publish {
    const { headers, ...properties } = msg.properties as any;
    const props: any = {
      ...properties,
      headers: { ...headers, [RETRY_COUNT_HEADER]: attempts, ...extraHeaders },
    };
    // A per-message TTL inside the wait-queue would fire before the intended delay
    // and dead-letter the copy straight back to the work queue, defeating the wait:
    // delayed copies drop the original expiration.
    if (delayMs > 0) delete props.expiration;
    return props;
  }

  async function scheduleRetry(msg: ConsumeMessage, attempts: number): Promise<void> {
    if (delayMs > 0) {
      // The delay is encoded in the queue name so a config change never collides
      // with an existing wait-queue asserted with different arguments (406).
      const waitQueue = `${queue}.retry.${delayMs}`;
      await ctx.assertRetryWaitQueue(waitQueue, delayMs, queue);
      await ctx.publish('', waitQueue, msg.content, retryProperties(msg, attempts));
    } else {
      // Default exchange routes by queue name: straight back to the work queue.
      await ctx.publish('', queue, msg.content, retryProperties(msg, attempts));
    }
  }

  /** A waiting RPC caller must fail fast, not burn its full timeout. */
  async function replyErrorToRpcCaller(msg: ConsumeMessage, error: any, attempts: number): Promise<void> {
    const { replyTo, correlationId, headers } = msg.properties;
    if (!replyTo || !correlationId) return;
    const cause = errorToPlain(error);
    try {
      await ctx.publish('', replyTo, {
        success: false,
        error: {
          name: RETRY_EXHAUSTED_ERROR,
          message: `Handler for queue '${queue}' failed after ${attempts} attempt(s): ${cause.message}`,
          cause,
        },
        // Echo the request headers so the requester's reply filter (correlationId +
        // X-Request-ID) matches.
      }, { correlationId, headers });
    } catch (replyError) {
      ctx.logger.warn(`[RETRY] queue '${queue}': could not send error reply to '${replyTo}' (${(replyError as Error)?.message})`);
    }
  }

  async function exhaust(msg: ConsumeMessage, error: any, attempts: number, retriable: boolean): Promise<void> {
    const reason = retriable ? `exhausted after ${attempts}/${maxAttempts} attempts` : 'not retriable (deserialization failed)';
    if (onExhausted === 'dead-letter' && policy.deadLetter?.exchange) {
      const routingKey = policy.deadLetter.routingKey ?? msg.fields.routingKey;
      await ctx.publish(policy.deadLetter.exchange, routingKey, msg.content, retryProperties(msg, attempts, {
        [RETRY_ERROR_HEADER]: errorToPlain(error).message,
        [RETRY_ORIGIN_QUEUE_HEADER]: queue,
      }));
      ctx.logger.error(`[RETRY] queue '${queue}': message ${reason} (${error?.message}); dead-lettered to '${policy.deadLetter.exchange}/${routingKey}'`);
    } else {
      ctx.logger.error(`[RETRY] queue '${queue}': message ${reason} (${error?.message}); dropped`);
    }
  }
}
