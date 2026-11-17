// jwks-rsa (transitively imported via JwtService) pulls in `jose` (ESM); stub it
// so Jest's CJS runtime can load the module graph.
jest.mock('jwks-rsa', () => ({
  JwksClient: class {
    constructor(_opts: any) { }
    getSigningKey(_kid: any, cb: any) { cb(new Error('no network in test')); }
  },
}));

import { Logger } from '@nestjs/common';
import { PathDefinition } from '../config/path-definition.config';
import { HttpHandlerService } from './http-handler.service';

// gateway.rateLimit as orchestrated by HttpHandlerService: who the bucket belongs to, where the
// check sits in the gate (after 401, before ACL/RPC) and the 429 response. The bucket arithmetic
// itself is pinned in token-bucket-limiter.spec, the config in rate-limit.spec.

const PROVIDER = { name: 'partner-jwks', type: 'jwks', headerPrefix: 'X-GTW-AUTH-', uidClaim: 'USERID' };

const mkService = (rateLimit: any, paths: PathDefinition[] = []) => {
  const broker = {
    requestData: jest.fn().mockResolvedValue({ ok: true }),
    publishMessage: jest.fn().mockResolvedValue(true),
  };
  const auth = {
    processAuthData: jest.fn().mockResolvedValue({ success: false }),
    extractResourceContext: jest.fn().mockReturnValue({ companyId: undefined, resourceId: undefined }),
    checkActions: jest.fn().mockResolvedValue(true),
    findProvider: jest.fn().mockReturnValue(PROVIDER),
  };
  const gatewayConfig: any = { headerPrefix: 'X-GTW-HTTP-', paths, events: [], rateLimit };
  const svc = new HttpHandlerService(
    {} as any, broker as any, {} as any, auth as any,
    { reload: jest.fn() } as any,
    { environment: 'test' } as any, gatewayConfig as any,
  );
  return { svc, broker, auth };
};

const mkReq = (over: any = {}) =>
  ({ method: 'GET', headers: {}, body: {}, query: {}, params: {}, ip: '10.0.0.1', files: undefined, ...over } as any);

const mkRes = () => {
  const res: any = {
    statusCode: 0, body: undefined, headers: {} as Record<string, string>,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    end(b?: any) { if (b !== undefined) this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
    setHeaders() { return this; },
    once() { return this; },
  };
  return res;
};

const handlerFor = (svc: HttpHandlerService, path: PathDefinition) => {
  let handler: any;
  const router: any = {};
  router[path.method.toLowerCase()] = (_p: string, ...handlers: any[]) => { handler = handlers[handlers.length - 1]; };
  svc.registerPath(path, router);
  return handler;
};

const route = (over: Partial<PathDefinition> = {}): PathDefinition => ({
  name: 'list-available-rides', method: 'GET', path: '/bookings/rides/list-available', topic: 'booking',
  action: 'list-available-rides', mode: 'rpc', dataSource: 'query', auth: 'partner-jwks',
  headers: {}, forwardHeaders: {}, redirect: 0, ...over,
} as PathDefinition);

const asUser = (auth: any, userId: string) =>
  auth.processAuthData.mockResolvedValue({ success: true, 'X-GTW-AUTH-USERID': userId });

/** Sends n requests in a row, returns the status codes. */
const fire = async (h: any, n: number, req: () => any = () => mkReq()) => {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = mkRes();
    await h(req(), res);
    codes.push(res.statusCode);
  }
  return codes;
};

describe('HttpHandlerService — gateway.rateLimit', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const LIMIT = { routes: [{ path: '/bookings/rides/list-available', method: 'GET', requestsPerSecond: 1, burst: 3 }] };

  it('without gateway.rateLimit nothing is limited', async () => {
    const { svc, auth, broker } = mkService(undefined);
    asUser(auth, 'u1');
    const codes = await fire(handlerFor(svc, route()), 50);
    expect(codes.every((c) => c === 200)).toBe(true);
    expect(broker.requestData).toHaveBeenCalledTimes(50);
  });

  it('over the limit: 429 with Retry-After and the unified envelope, nothing forwarded', async () => {
    const { svc, auth, broker } = mkService(LIMIT);
    asUser(auth, 'u1');
    const h = handlerFor(svc, route());
    expect(await fire(h, 3)).toEqual([200, 200, 200]);
    const res = mkRes();
    await h(mkReq(), res);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('1');
    expect(res.body).toMatchObject({ statusCode: 429, code: 'TooManyRequestsError', message: 'Too many requests' });
    expect(broker.requestData).toHaveBeenCalledTimes(3);
  });

  it('the bucket refills: after 1 s one more request passes', async () => {
    const { svc, auth } = mkService(LIMIT);
    asUser(auth, 'u1');
    const h = handlerFor(svc, route());
    await fire(h, 4);
    jest.advanceTimersByTime(1000);
    expect(await fire(h, 2)).toEqual([200, 429]);
  });

  it('one bucket per user: another user is not slowed down, even from the same IP', async () => {
    const { svc, auth } = mkService(LIMIT);
    const h = handlerFor(svc, route());
    asUser(auth, 'u1');
    expect(await fire(h, 4)).toEqual([200, 200, 200, 429]);
    asUser(auth, 'u2');
    expect(await fire(h, 3)).toEqual([200, 200, 200]);
  });

  it('one bucket per route: the limit of one route does not spend another route', async () => {
    const { svc, auth } = mkService({ default: { requestsPerSecond: 1, burst: 2 } });
    asUser(auth, 'u1');
    const a = handlerFor(svc, route({ path: '/a' }));
    const b = handlerFor(svc, route({ path: '/b' }));
    expect(await fire(a, 3)).toEqual([200, 200, 429]);
    expect(await fire(b, 2)).toEqual([200, 200]);
  });

  it('the default applies to every route, a route rule overrides it, enabled: false exempts', async () => {
    const { svc, auth } = mkService({
      default: { requestsPerSecond: 1, burst: 5 },
      routes: [{ path: '/tight', requestsPerSecond: 1, burst: 1 }, { path: '/free', enabled: false }],
    });
    asUser(auth, 'u1');
    expect(await fire(handlerFor(svc, route({ path: '/any' })), 6)).toEqual([200, 200, 200, 200, 200, 429]);
    expect(await fire(handlerFor(svc, route({ path: '/tight' })), 2)).toEqual([200, 429]);
    expect((await fire(handlerFor(svc, route({ path: '/free' })), 20)).every((c) => c === 200)).toBe(true);
  });

  it('the route rule matches on method too', async () => {
    const { svc, auth } = mkService(LIMIT);
    asUser(auth, 'u1');
    const post = handlerFor(svc, route({ method: 'POST' }));
    expect((await fire(post, 10)).every((c) => c === 200)).toBe(true);
  });

  it('anonymous route: the bucket is the client IP', async () => {
    const { svc, auth } = mkService({ routes: [{ path: '/public', requestsPerSecond: 1, burst: 2 }] });
    auth.processAuthData.mockResolvedValue({ success: false });
    const h = handlerFor(svc, route({ path: '/public', auth: undefined, allowAnonymous: true }));
    expect(await fire(h, 3, () => mkReq({ ip: '1.1.1.1' }))).toEqual([200, 200, 429]);
    expect(await fire(h, 2, () => mkReq({ ip: '2.2.2.2' }))).toEqual([200, 200]);
  });

  it('anonymous route with a valid token: the bucket is the user, not the IP', async () => {
    const { svc, auth } = mkService({ routes: [{ path: '/public', requestsPerSecond: 1, burst: 1 }] });
    const h = handlerFor(svc, route({ path: '/public', allowAnonymous: true }));
    asUser(auth, 'u1');
    expect(await fire(h, 2)).toEqual([200, 429]);
    auth.processAuthData.mockResolvedValue({ success: false }); // same IP, no token: its own bucket
    expect(await fire(h, 1)).toEqual([200]);
  });

  it('ipHeader: the client IP comes from that header (first entry of a list), else from the socket', async () => {
    const { svc } = mkService({ ipHeader: 'X-Forwarded-For', routes: [{ path: '/public', requestsPerSecond: 1, burst: 1 }] });
    const h = handlerFor(svc, route({ path: '/public', auth: undefined, allowAnonymous: true }));
    const from = (xff?: string) => () => mkReq({ ip: '172.18.0.2', headers: xff ? { 'x-forwarded-for': xff } : {} });
    expect(await fire(h, 2, from('5.5.5.5, 172.18.0.1'))).toEqual([200, 429]);
    expect(await fire(h, 1, from('6.6.6.6'))).toEqual([200]); // same proxy, another client
    expect(await fire(h, 2, from())).toEqual([200, 429]); // no header: the proxy's own address
  });

  it('an unauthenticated request on a protected route gets 401 and spends no token', async () => {
    const { svc, auth } = mkService(LIMIT);
    const h = handlerFor(svc, route());
    auth.processAuthData.mockResolvedValue({ success: false });
    expect(await fire(h, 5)).toEqual([401, 401, 401, 401, 401]);
    asUser(auth, 'u1');
    expect(await fire(h, 3)).toEqual([200, 200, 200]);
  });

  it('the limit is checked before the ACL: a rejected request costs no ACL lookup', async () => {
    const { svc, auth } = mkService(LIMIT);
    asUser(auth, 'u1');
    const h = handlerFor(svc, route({ actions: ['partner-rides'] }));
    expect(await fire(h, 5)).toEqual([200, 200, 200, 429, 429]);
    expect(auth.checkActions).toHaveBeenCalledTimes(3);
  });

  it('logs the rejections once, not once per request', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, auth } = mkService(LIMIT);
    asUser(auth, 'u1');
    await fire(handlerFor(svc, route()), 50);
    const rateLimitWarnings = warn.mock.calls.filter(([m]) => String(m).includes('[RATE-LIMIT]'));
    expect(rateLimitWarnings).toHaveLength(1);
    expect(String(rateLimitWarnings[0][0])).toContain('user:u1');
  });

  it('warns about a route rule that matches no route', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc } = mkService(
      { routes: [{ path: '/bookings/rides/list-available', requestsPerSecond: 1 }, { path: '/typo', requestsPerSecond: 1 }] },
      [route()],
    );
    (svc as any).server = { use: jest.fn() };
    await svc.reload();
    const messages = warn.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes("'* /typo' matches no route"))).toBe(true);
    expect(messages.some((m) => m.includes('list-available') && m.includes('matches no route'))).toBe(false);
  });

  it('a malformed gateway.rateLimit stops the gateway at construction', () => {
    expect(() => mkService({ default: { requestsPerSecond: -5 } })).toThrow(/requestsPerSecond/);
  });

  it('a microservice throwing TooManyRequestsError is answered 429 too', async () => {
    const { svc, auth, broker } = mkService(undefined);
    asUser(auth, 'u1');
    broker.requestData.mockRejectedValue(Object.assign(new Error('slow down'), { name: 'TooManyRequestsError' }));
    const res = mkRes();
    await handlerFor(svc, route())(mkReq(), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ code: 'TooManyRequestsError', message: 'slow down' });
  });
});
