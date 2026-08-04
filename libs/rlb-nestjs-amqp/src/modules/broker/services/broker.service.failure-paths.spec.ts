import { Logger } from '@nestjs/common';
import { BrokerService } from './broker.service';

// Boot-time audit of the configurations that turn one failing message into an endless
// loop: `errorBehavior: requeue` (infinite nack-requeue, and it silently overrides
// broker.retry), a retry dead-letter that routes back into the consuming queue, and a
// queue-level deadLetterExchange bound to its own queue.

const mkService = (topics: any[], brokerConfig: any = {}) => {
  const amqp = { createRpc: jest.fn(), createSubscriber: jest.fn() };
  const registry = { registerHandler: jest.fn(), getHandlers: jest.fn(), clear: jest.fn() };
  const utils = { error2Object: (e: any) => e };
  return new BrokerService(amqp as any, registry as any, { queues: [], exchanges: [], ...brokerConfig }, topics, utils as any);
};

const messages = (spy: jest.SpyInstance) => spy.mock.calls.map(c => String(c[0]));
const matching = (spy: jest.SpyInstance, needle: string) => messages(spy).filter(m => m.includes(needle));

describe('BrokerService failure-path validation', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('flags errorBehavior: requeue and says it overrides broker.retry', () => {
    const svc = mkService(
      [{ name: 't', mode: 'handle', queue: 'q', errorBehavior: 'requeue' }],
      { queues: [{ name: 'q', exchange: 'ex', routingKey: 'rk' }], exchanges: [{ name: 'ex', type: 'direct' }], retry: { maxAttempts: 5 } },
    );

    svc.onModuleInit();

    expect(matching(warn, 'hot-loops the consumer')).toHaveLength(1);
    expect(matching(warn, 'overriding broker.retry')).toHaveLength(1);
  });

  it('does not flag errorBehavior when the topic also declares retry (retry wins)', () => {
    const svc = mkService(
      [{ name: 't', mode: 'handle', queue: 'q', errorBehavior: 'requeue', retry: { maxAttempts: 3 } }],
      { queues: [{ name: 'q', exchange: 'ex', routingKey: 'rk' }], exchanges: [{ name: 'ex', type: 'direct' }] },
    );

    svc.onModuleInit();

    expect(matching(warn, 'hot-loops the consumer')).toHaveLength(0);
  });

  it('detects a dead-letter exchange that routes back into the consuming queue', () => {
    const svc = mkService(
      [{ name: 't', mode: 'handle', queue: 'q', routingKey: 'rk', retry: { maxAttempts: 3, deadLetter: { exchange: 'ex' } } }],
      { queues: [{ name: 'q', exchange: 'ex', routingKey: 'rk' }], exchanges: [{ name: 'ex', type: 'direct' }] },
    );

    svc.onModuleInit();

    expect(matching(error, 'routes back to its own queue')).toHaveLength(1);
  });

  it('detects the cycle through a wildcard binding on a topic exchange', () => {
    const svc = mkService(
      [{ name: 't', mode: 'handle', queue: 'q', routingKey: 'orders.created', retry: { deadLetter: { exchange: 'ex' } } }],
      { queues: [{ name: 'q', exchange: 'ex', routingKey: 'orders.#' }], exchanges: [{ name: 'ex', type: 'topic' }] },
    );

    svc.onModuleInit();

    expect(matching(error, 'routes back to its own queue')).toHaveLength(1);
  });

  it('accepts a dedicated dead-letter exchange without any warning', () => {
    const svc = mkService(
      [{ name: 't', mode: 'handle', queue: 'q', routingKey: 'rk', retry: { deadLetter: { exchange: 'dlx' } } }],
      {
        queues: [{ name: 'q', exchange: 'ex', routingKey: 'rk' }],
        exchanges: [{ name: 'ex', type: 'direct' }, { name: 'dlx', type: 'fanout' }],
      },
    );

    svc.onModuleInit();

    expect(messages(error)).toHaveLength(0);
    expect(messages(warn)).toHaveLength(0);
  });

  it('warns when the dead-letter lands in ANOTHER live work queue instead of parking', () => {
    const svc = mkService(
      [
        { name: 'a', mode: 'handle', queue: 'qa', routingKey: 'k', retry: { deadLetter: { exchange: 'ex' } } },
        { name: 'b', mode: 'handle', queue: 'qb', routingKey: 'k' },
      ],
      {
        queues: [{ name: 'qa', exchange: 'other', routingKey: 'k' }, { name: 'qb', exchange: 'ex', routingKey: 'k' }],
        exchanges: [{ name: 'ex', type: 'direct' }, { name: 'other', type: 'direct' }],
      },
    );

    svc.onModuleInit();

    expect(matching(warn, 'a live work queue')).toHaveLength(1);
    expect(matching(error, 'routes back to its own queue')).toHaveLength(0);
  });

  it('still warns when the dead-letter exchange is not declared in broker.exchanges', () => {
    const svc = mkService(
      [{ name: 't', mode: 'handle', queue: 'q', routingKey: 'rk', retry: { deadLetter: { exchange: 'ghost' } } }],
      { queues: [{ name: 'q', exchange: 'ex', routingKey: 'rk' }], exchanges: [{ name: 'ex', type: 'direct' }] },
    );

    svc.onModuleInit();

    expect(matching(warn, "'ghost' is not declared")).toHaveLength(1);
  });

  it('detects a queue-level deadLetterExchange bound back to the same queue', () => {
    const svc = mkService([], {
      queues: [{ name: 'q', exchange: 'ex', routingKey: 'rk', options: { messageTtl: 60000, deadLetterExchange: 'ex' } }],
      exchanges: [{ name: 'ex', type: 'direct' }],
    });

    svc.onModuleInit();

    expect(matching(error, 'cycles forever')).toHaveLength(1);
  });
});
