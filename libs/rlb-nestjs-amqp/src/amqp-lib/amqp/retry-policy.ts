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
 * Best-effort `action` from the message envelope (`{ action, payload }`) — for logs only.
 * The connection-level error handler runs outside the deserialization path, so it never
 * sees the decoded message; content that is not a JSON envelope (raw payloads, or the very
 * deserialization failure that brought us here) simply yields no action.
 */
function readAction(msg: ConsumeMessage): string | undefined {
  try {
    const parsed = JSON.parse(msg.content.toString());
    return typeof parsed?.action === 'string' ? parsed.action : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What failed, in application terms: `topic 'x' action 'y' (queue 'q')`, degrading to the
 * queue name alone when the subscription carries no topic and the envelope no action.
 */
function describeSource(msg: ConsumeMessage, queue: string, topic?: string): string {
  const action = readAction(msg);
  const parts: string[] = [];
  if (topic) parts.push(`topic '${topic}'`);
  if (action) parts.push(`action '${action}'`);
  return parts.length ? `${parts.join(' ')} (queue '${queue}')` : `queue '${queue}'`;
}

/**
 * Attempts already made on this message, from the counter stamped on retry copies.
 * A missing or malformed header counts as a first delivery: without this, a garbage
 * value made `attempts` NaN, which compares false against every bound — the message
 * skipped straight to dead-letter carrying `x-retry-count: NaN`, and a cycling copy
 * could never be recognized as exhausted.
 */
function readAttempts(msg: ConsumeMessage): number {
  const raw = Number(msg.properties.headers?.[RETRY_COUNT_HEADER]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

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
 * - ALREADY exhausted on arrival (`x-retry-count` >= maxAttempts, i.e. a copy that
 *   was dead-lettered and routed back here) → acked and dropped, no reply and no
 *   re-publish: re-running the exhausted path would re-feed the routing cycle
 *   forever.
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
  topic?: string,
): MessageErrorHandler {
  const maxAttempts = Math.max(1, policy.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts);
  const delayMs = policy.delayMs ?? DEFAULT_RETRY_POLICY.delayMs;
  const onExhausted = policy.onExhausted ?? (policy.deadLetter ? 'dead-letter' : 'drop');

  return async (channel: Channel, msg: ConsumeMessage, error: any): Promise<void> => {
    // Resolved once per failure, before the try: the catch path logs it too.
    const source = describeSource(msg, queue, topic);
    try {
      const priorAttempts = readAttempts(msg);
      const attempts = priorAttempts + 1;
      const retriable = !(error instanceof MessageDeserializationError);

      // The message already carries a FULL attempt count, so it went through the whole
      // exhaustion path once and came back — which only happens through a routing cycle
      // (a `deadLetter.exchange` bound back to this queue: the default dead-letter
      // routing key is the message's ORIGINAL one, so reusing the work exchange closes
      // the loop; or a queue-level `deadLetterExchange` that recycles). Dead-lettering
      // it again feeds the same cycle forever: `attempts` keeps growing but
      // `attempts < maxAttempts` is already false, so no further branch ever stops it.
      // Drop it here instead — a waiting RPC caller was already answered when the
      // message first exhausted.
      if (priorAttempts >= maxAttempts) {
        ctx.logger.error(
          `[RETRY][LOOP] ${source}: re-delivered after already exhausting ${priorAttempts}/${maxAttempts} attempts (${error?.message}); dropped without re-publishing to break the loop — check that the dead-letter routing does not lead back to '${queue}' (or that maxAttempts was not lowered while messages were in flight)`,
        );
        channel.ack(msg);
        return;
      }

      if (retriable && attempts < maxAttempts) {
        await scheduleRetry(msg, attempts);
        ctx.logger.warn(`[RETRY] ${source}: attempt ${attempts}/${maxAttempts} failed (${error?.message}); retrying${delayMs > 0 ? ` in ${delayMs}ms` : ''}`);
      } else {
        await replyErrorToRpcCaller(msg, error, attempts, source);
        await exhaust(msg, error, attempts, retriable, source);
      }
      channel.ack(msg);
    } catch (republishError) {
      // The message could not be handed anywhere safe (broker publish failed):
      // keep it on the broker with a single requeue instead of losing it.
      ctx.logger.error(`[RETRY] ${source}: could not re-publish/dead-letter message (${(republishError as Error)?.message}); falling back to nack-requeue`);
      try {
        channel.nack(msg, false, true);
      } catch (nackError) {
        // Channel died in the meantime: the unacked message is redelivered on reconnect anyway.
        ctx.logger.error(`[RETRY] ${source}: nack failed (${(nackError as Error)?.message}); message will be redelivered on reconnect`);
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
  async function replyErrorToRpcCaller(msg: ConsumeMessage, error: any, attempts: number, source: string): Promise<void> {
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
      ctx.logger.warn(`[RETRY] ${source}: could not send error reply to '${replyTo}' (${(replyError as Error)?.message})`);
    }
  }

  async function exhaust(msg: ConsumeMessage, error: any, attempts: number, retriable: boolean, source: string): Promise<void> {
    const reason = retriable ? `exhausted after ${attempts}/${maxAttempts} attempts` : 'not retriable (deserialization failed)';
    if (onExhausted === 'dead-letter' && policy.deadLetter?.exchange) {
      const routingKey = policy.deadLetter.routingKey ?? msg.fields.routingKey;
      await ctx.publish(policy.deadLetter.exchange, routingKey, msg.content, retryProperties(msg, attempts, {
        [RETRY_ERROR_HEADER]: errorToPlain(error).message,
        [RETRY_ORIGIN_QUEUE_HEADER]: queue,
      }));
      ctx.logger.error(`[RETRY][EXHAUSTED] ${source}: message ${reason} (${error?.message}); dead-lettered to '${policy.deadLetter.exchange}/${routingKey}'`);
    } else {
      ctx.logger.error(`[RETRY][EXHAUSTED] ${source}: message ${reason} (${error?.message}); dropped`);
    }
  }
}
