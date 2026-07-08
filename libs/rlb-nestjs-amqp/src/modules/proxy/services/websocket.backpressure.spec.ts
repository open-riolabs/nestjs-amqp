// jwks-rsa (transitively imported via JwtService/HttpAuthHandlerService types) pulls in
// `jose` (ESM); stub it so Jest's CJS runtime can load the module graph.
jest.mock('jwks-rsa', () => ({
  JwksClient: class {
    constructor(_opts: any) { }
    getSigningKey(_kid: any, cb: any) { cb(new Error('no network in test')); }
  },
}));

import { Subject } from 'rxjs';
import { WebSocket } from 'ws';
import { WebSocketService } from './websocket.service';

// Regression tests for the WS delivery path:
// 1. boot fail-soft — a down events source must NOT abort onModuleInit (it used to kill
//    the whole gateway at boot);
// 2. outbound backpressure — a slow-but-alive client must not grow the gateway's send
//    buffer without bound: above ws.maxBufferedBytes its messages are dropped until it drains.

const mkService = (gatewayConfig: any) => {
  const amqp = { createSubscriber: jest.fn().mockResolvedValue({ consumerTag: 'ct' }) };
  const broker = { requestData: jest.fn(), topics: [] as any[] };
  const httpAuth = { findProvider: jest.fn(), verifyToken: jest.fn(), mapClaims: jest.fn(), checkActionsForClaims: jest.fn() };
  const svc = new WebSocketService(
    amqp as any, {} as any, broker as any, httpAuth as any,
    gatewayConfig,
    { connectionManagerOptions: { connectionOptions: { clientProperties: { connection_name: 'gw-test' } } } } as any,
  );
  return { svc, amqp, broker };
};

const mkClient = (over: Partial<any> = {}) => ({
  id: 'client-1',
  isAlive: true,
  readyState: WebSocket.OPEN,
  bufferedAmount: 0,
  send: jest.fn(),
  close: jest.fn(),
  ...over,
}) as any;

describe('WebSocketService', () => {
  it('boot: a failing remote events source degrades to YAML events instead of crashing onModuleInit', async () => {
    const { svc, broker, amqp } = mkService({
      loadConfig: { events: { topic: 'src-topic', action: 'src-action' } },
      events: [{ name: 'local-ev', type: 'ws', exchange: 'ex', routingKey: 'rk' }],
      ws: {},
    });
    broker.requestData.mockRejectedValue(new Error('RpcTimeoutError: source down'));

    await expect(svc.onModuleInit()).resolves.toBeUndefined();

    // The YAML event is still wired to its AMQP subscriber.
    expect(amqp.createSubscriber).toHaveBeenCalledTimes(1);
    expect((svc as any).wsEvents.map((e: any) => e.name)).toEqual(['local-ev']);
  });

  it('boot: a non-array reply from the events source is ignored', async () => {
    const { svc, broker } = mkService({
      loadConfig: { events: { topic: 'src-topic', action: 'src-action' } },
      events: [],
      ws: {},
    });
    broker.requestData.mockResolvedValue({ not: 'an array' });

    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    expect((svc as any).wsEvents).toEqual([]);
  });

  describe('outbound backpressure', () => {
    const eventDef = { name: 'ev', type: 'ws' } as any;

    const subscribe = async (svc: any, client: any) => {
      svc.subjects['ev'] = svc.subjects['ev'] || new Subject();
      await svc.subscribeClient(client, eventDef);
      return svc.subjects['ev'] as Subject<any>;
    };

    it('delivers normally below the cap and drops above it, resuming after the client drains', async () => {
      const { svc } = mkService({ events: [], ws: { maxBufferedBytes: 1000 } });
      const client = mkClient();
      const subject = await subscribe(svc as any, client);

      subject.next({ payload: { n: 1 } });
      expect(client.send).toHaveBeenCalledTimes(1);

      client.bufferedAmount = 5000; // saturated: slow client, buffer above cap
      subject.next({ payload: { n: 2 } });
      subject.next({ payload: { n: 3 } });
      expect(client.send).toHaveBeenCalledTimes(1); // both dropped

      client.bufferedAmount = 0; // drained
      subject.next({ payload: { n: 4 } });
      expect(client.send).toHaveBeenCalledTimes(2);
      expect(JSON.parse(client.send.mock.calls[1][0]).data).toEqual({ n: 4 });
    });

    it('does not send on sockets that are not OPEN', async () => {
      const { svc } = mkService({ events: [], ws: {} });
      const client = mkClient({ readyState: WebSocket.CLOSING });
      const subject = await subscribe(svc as any, client);

      subject.next({ payload: { n: 1 } });
      expect(client.send).not.toHaveBeenCalled();
    });
  });
});
