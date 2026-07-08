import { MessageDeserializationError } from '../models/errors.model';
import {
  createRetryErrorHandler,
  RETRY_COUNT_HEADER,
  RETRY_ERROR_HEADER,
  RETRY_EXHAUSTED_ERROR,
  RETRY_ORIGIN_QUEUE_HEADER,
  RetryPolicyContext,
} from './retry-policy';

// Unit tests for the bounded retry policy that replaced the legacy infinite
// nack-requeue default: re-publish with incremented counter (optionally via the
// TTL wait-queue), error reply to a waiting RPC caller on exhaustion, then
// dead-letter or drop — and never throw out of the error handler.

const mkCtx = () => ({
  publish: jest.fn().mockResolvedValue(true),
  assertRetryWaitQueue: jest.fn().mockResolvedValue(undefined),
  logger: { warn: jest.fn(), error: jest.fn() },
}) satisfies RetryPolicyContext;

const mkChannel = () => ({ ack: jest.fn(), nack: jest.fn() }) as any;

const mkMsg = (over: any = {}) => ({
  content: Buffer.from('{"a":1}'),
  fields: { routingKey: 'rk', exchange: 'ex', consumerTag: 'ct', deliveryTag: 1, redelivered: false },
  properties: { headers: {}, contentType: 'application/json', ...over },
}) as any;

describe('createRetryErrorHandler', () => {
  it('first failure: republishes to the work queue via the default exchange with x-retry-count=1 and acks', async () => {
    const ctx = mkCtx();
    const channel = mkChannel();
    const handler = createRetryErrorHandler('q', { maxAttempts: 3 }, ctx);
    const msg = mkMsg({ correlationId: 'c1', expiration: '10000' });

    await handler(channel, msg, new Error('boom'));

    expect(ctx.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, content, props] = ctx.publish.mock.calls[0];
    expect(exchange).toBe('');
    expect(routingKey).toBe('q');
    expect(content).toBe(msg.content);
    expect(props.headers[RETRY_COUNT_HEADER]).toBe(1);
    expect(props.correlationId).toBe('c1');
    expect(props.expiration).toBe('10000'); // immediate retries keep the original TTL
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('delayMs > 0: asserts the TTL wait-queue, publishes there and strips the per-message expiration', async () => {
    const ctx = mkCtx();
    const channel = mkChannel();
    const handler = createRetryErrorHandler('q', { maxAttempts: 3, delayMs: 5000 }, ctx);

    await handler(channel, mkMsg({ expiration: '10000' }), new Error('boom'));

    expect(ctx.assertRetryWaitQueue).toHaveBeenCalledWith('q.retry.5000', 5000, 'q');
    const [exchange, routingKey, , props] = ctx.publish.mock.calls[0];
    expect(exchange).toBe('');
    expect(routingKey).toBe('q.retry.5000');
    // A TTL shorter than the delay would dead-letter the copy straight back, skipping the wait.
    expect(props.expiration).toBeUndefined();
    expect(channel.ack).toHaveBeenCalled();
  });

  it('exhausted in drop mode: no republish, acks and logs the drop', async () => {
    const ctx = mkCtx();
    const channel = mkChannel();
    const handler = createRetryErrorHandler('q', { maxAttempts: 3, onExhausted: 'drop' }, ctx);

    await handler(channel, mkMsg({ headers: { [RETRY_COUNT_HEADER]: 2 } }), new Error('still failing'));

    expect(ctx.publish).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalled();
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('dropped'));
  });

  it('exhausted with deadLetter: publishes the copy to the DL exchange with diagnostic headers', async () => {
    const ctx = mkCtx();
    const channel = mkChannel();
    const handler = createRetryErrorHandler('q', { maxAttempts: 2, deadLetter: { exchange: 'dlx' } }, ctx);

    await handler(channel, mkMsg({ headers: { [RETRY_COUNT_HEADER]: 1 } }), new Error('still failing'));

    expect(ctx.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, , props] = ctx.publish.mock.calls[0];
    expect(exchange).toBe('dlx');
    expect(routingKey).toBe('rk'); // defaults to the original routing key
    expect(props.headers[RETRY_ERROR_HEADER]).toBe('still failing');
    expect(props.headers[RETRY_ORIGIN_QUEUE_HEADER]).toBe('q');
    expect(channel.ack).toHaveBeenCalled();
  });

  it('exhausted RPC message: sends the error reply (correlationId + echoed headers) before dead-lettering', async () => {
    const ctx = mkCtx();
    const channel = mkChannel();
    const handler = createRetryErrorHandler('q', { maxAttempts: 1, deadLetter: { exchange: 'dlx', routingKey: 'dead' } }, ctx);
    const headers = { 'X-Request-ID': 'r1' };

    await handler(channel, mkMsg({ replyTo: 'amq.rabbitmq.reply-to.x', correlationId: 'c9', headers }), new Error('kaputt'));

    expect(ctx.publish).toHaveBeenCalledTimes(2);
    const [exchange, routingKey, body, props] = ctx.publish.mock.calls[0];
    expect(exchange).toBe('');
    expect(routingKey).toBe('amq.rabbitmq.reply-to.x');
    expect(body.success).toBe(false);
    expect(body.error.name).toBe(RETRY_EXHAUSTED_ERROR);
    expect(body.error.cause.message).toBe('kaputt');
    expect(props.correlationId).toBe('c9');
    expect(props.headers).toBe(headers); // echo so the requester's reply filter matches
    expect(ctx.publish.mock.calls[1][0]).toBe('dlx');
    expect(ctx.publish.mock.calls[1][1]).toBe('dead');
  });

  it('deserialization errors are NOT retried: straight to the exhausted path on the first attempt', async () => {
    const ctx = mkCtx();
    const channel = mkChannel();
    const handler = createRetryErrorHandler('q', { maxAttempts: 5, deadLetter: { exchange: 'dlx' } }, ctx);

    await handler(channel, mkMsg(), new MessageDeserializationError(new Error('bad json')));

    expect(ctx.publish).toHaveBeenCalledTimes(1);
    expect(ctx.publish.mock.calls[0][0]).toBe('dlx'); // dead-letter, not a retry re-publish
    expect(channel.ack).toHaveBeenCalled();
  });

  it('republish failure: falls back to a single nack-requeue and never throws', async () => {
    const ctx = mkCtx();
    ctx.publish.mockRejectedValue(new Error('broker gone'));
    const channel = mkChannel();
    const handler = createRetryErrorHandler('q', { maxAttempts: 3 }, ctx);
    const msg = mkMsg();

    await expect(handler(channel, msg, new Error('boom'))).resolves.toBeUndefined();

    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('even the nack fallback failing does not throw (channel died mid-flight)', async () => {
    const ctx = mkCtx();
    ctx.publish.mockRejectedValue(new Error('broker gone'));
    const channel = mkChannel();
    channel.nack.mockImplementation(() => { throw new Error('channel closed'); });
    const handler = createRetryErrorHandler('q', {}, ctx);

    await expect(handler(channel, mkMsg(), new Error('boom'))).resolves.toBeUndefined();
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});
