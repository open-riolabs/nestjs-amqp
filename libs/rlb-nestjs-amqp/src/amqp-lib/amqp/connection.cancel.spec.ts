import { AmqpConnection } from './connection';

// Regression tests for consumer cancellation. The old implementation delegated to
// ChannelWrapper.cancel(), which only knows consumers created via wrapper.consume()
// (never used here) — so cancel was a silent no-op and a "drained" instance kept
// consuming, acking messages against an already-cleared handler registry (message loss
// on every graceful shutdown). The fix issues basic.cancel on the raw channel that
// created each consumer and latches consumersCanceled so reconnect setups can't
// resurrect them.

const mkConnection = () =>
  new AmqpConnection({
    uri: 'amqp://localhost:5672/',
    connectionManagerOptions: { connectionOptions: { clientProperties: {} } },
  } as any);

const mkChannel = () => ({ cancel: jest.fn().mockResolvedValue(undefined) }) as any;

describe('AmqpConnection consumer cancellation', () => {
  it('cancelConsumer issues basic.cancel on the channel that created the consumer', async () => {
    const conn = mkConnection();
    const channel = mkChannel();
    (conn as any)._consumers['tag-1'] = { type: 'subscribe', consumerTag: 'tag-1', handler: jest.fn(), msgOptions: {}, channel };

    await conn.cancelConsumer('tag-1');

    expect(channel.cancel).toHaveBeenCalledWith('tag-1');
    expect((conn as any)._consumers['tag-1']).toBeUndefined();
  });

  it('cancelAllConsumers cancels every registered consumer and survives a dead channel', async () => {
    const conn = mkConnection();
    const live = mkChannel();
    const dead = mkChannel();
    dead.cancel.mockRejectedValue(new Error('channel closed')); // stale pre-reconnect entry
    (conn as any)._consumers['t1'] = { type: 'subscribe', consumerTag: 't1', handler: jest.fn(), msgOptions: {}, channel: live };
    (conn as any)._consumers['t2'] = { type: 'rpc', consumerTag: 't2', handler: jest.fn(), msgOptions: {}, channel: dead };

    await expect(conn.cancelAllConsumers()).resolves.toBeUndefined();

    expect(live.cancel).toHaveBeenCalledWith('t1');
    expect(dead.cancel).toHaveBeenCalledWith('t2');
    expect(Object.keys((conn as any)._consumers)).toHaveLength(0);
  });

  it('after cancelAllConsumers new subscriptions are refused (graceful-drain latch)', async () => {
    const conn = mkConnection();
    await conn.cancelAllConsumers();

    await expect(
      conn.createSubscriber(jest.fn(), { queue: 'q' } as any, 'handler'),
    ).rejects.toThrow(/canceled/);
  });
});
