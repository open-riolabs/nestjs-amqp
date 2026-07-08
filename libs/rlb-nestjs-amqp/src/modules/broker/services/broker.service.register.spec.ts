import { BrokerService } from './broker.service';

// Regression tests for the programmatic registerRpc API and the onModuleInit pool
// building. `queueName` was never assigned when building the rpc pool, so every
// entry had `queue: undefined` and registerRpc crashed with a TypeError on
// `queue.name` at the first call; a handle topic referencing a missing queue
// likewise crashed boot by dereferencing `queue.exchange` before the null-check.

const mkService = (topics: any[], queues: any[] = [], exchanges: any[] = []) => {
  const amqp = {
    createRpc: jest.fn().mockResolvedValue({ consumerTag: 'ct-1' }),
    createSubscriber: jest.fn().mockResolvedValue({ consumerTag: 'ct-2' }),
  };
  const registry = { registerHandler: jest.fn(), getHandlers: jest.fn(), clear: jest.fn() };
  const utils = { error2Object: (e: any) => ({ name: e?.name, message: e?.message }) };
  const brokerConfig: any = { queues, exchanges };
  const svc = new BrokerService(amqp as any, registry as any, brokerConfig, topics, utils as any);
  return { svc, amqp, registry };
};

describe('BrokerService registration', () => {
  it('onModuleInit stores the rpc topic queue in the pool (was: never assigned)', async () => {
    const { svc, amqp } = mkService(
      [{ name: 't1', mode: 'rpc', queue: 'q1' }],
      [{ name: 'q1', exchange: 'ex', routingKey: 'rk' }],
    );
    svc.onModuleInit();

    await svc.registerRpc('t1', jest.fn());

    expect(amqp.createRpc).toHaveBeenCalledTimes(1);
    const options = amqp.createRpc.mock.calls[0][1];
    expect(options.queue).toBe('q1');
    expect(options.exchange).toBe('ex');
    expect(options.routingKey).toBe('rk');
  });

  it('registerRpc works for exchange-only rpc topics (no queue configured)', async () => {
    const { svc, amqp } = mkService([{ name: 't2', mode: 'rpc', exchange: 'ex2', routingKey: 'rk2' }]);
    svc.onModuleInit();

    await svc.registerRpc('t2', jest.fn());

    expect(amqp.createRpc).toHaveBeenCalledTimes(1);
    const options = amqp.createRpc.mock.calls[0][1];
    expect(options.queue).toBeUndefined();
    expect(options.exchange).toBe('ex2');
    expect(options.routingKey).toBe('rk2');
  });

  it('registerRpc fails gracefully (no throw) when the pool queue is missing from broker.queues', async () => {
    const { svc, amqp } = mkService([{ name: 't3', mode: 'rpc', queue: 'ghost' }]);
    svc.onModuleInit();

    await expect(svc.registerRpc('t3', jest.fn())).resolves.toBeUndefined();
    expect(amqp.createRpc).not.toHaveBeenCalled();
  });

  it('onModuleInit does not crash on a handle topic referencing a nonexistent queue', () => {
    const { svc } = mkService([{ name: 'h1', mode: 'handle', queue: 'missing-queue' }]);
    expect(() => svc.onModuleInit()).not.toThrow();
  });
});
