// jwks-rsa (transitively imported via JwtService) pulls in `jose` (ESM); stub it
// so Jest's CJS runtime can load the module graph.
jest.mock('jwks-rsa', () => ({
  JwksClient: class {
    constructor(_opts: any) { }
    getSigningKey(_kid: any, cb: any) { cb(new Error('no network in test')); }
  },
}));

import type { BrokerHttpDataSource } from '../../broker/decorators/broker-action.decorator';
import { PathDefinition } from '../config/path-definition.config';
import { HttpAuthHandlerService } from './http-auth-handler.service';
import { HttpHandlerService } from './http-handler.service';

// End-to-end test of the gateway auth/auth gate as orchestrated by HttpHandlerService.
// HttpAuthHandlerService is mocked (its own logic is unit-tested in the .security.spec),
// so these tests pin the gate's wiring: allowAnonymous short-circuit, 401/403 enforcement,
// and the anti-spoofing header precedence (auth-derived claims win over forwardHeaders).

const mkService = () => {
  const broker = {
    requestData: jest.fn().mockResolvedValue({ ok: true }),
    publishMessage: jest.fn().mockResolvedValue(true),
  };
  const auth = {
    processAuthData: jest.fn().mockResolvedValue({ success: false }),
    extractResourceContext: jest.fn().mockReturnValue({ companyId: undefined, resourceId: undefined }),
    checkActions: jest.fn().mockResolvedValue(true),
    findProvider: jest.fn().mockReturnValue({ name: 'p' }),
  };
  const utils = { error2Object: (e: any) => ({ name: e?.name, message: e?.message }) };
  const gatewayConfig: any = { headerPrefix: 'X-GTW-AUTH-', paths: [], events: [] };
  const svc = new HttpHandlerService(
    {} as any, broker as any, utils as any, auth as any,
    { reload: jest.fn() } as any, // AuthProviderRegistry (unused by registerPath/handler tests)
    { environment: 'test' } as any, gatewayConfig as any,
  );
  return { svc, broker, auth, gatewayConfig };
};

const mkReq = (over: any = {}) =>
  ({ method: 'POST', headers: {}, body: {}, query: {}, params: {}, files: undefined, ...over } as any);

const mkRes = () => {
  const res: any = {
    statusCode: 0, body: undefined,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    end(b?: any) { if (b !== undefined) this.body = b; return this; },
    setHeaders() { return this; },
    redirect(c: number, url: string) { this.statusCode = c; this.body = url; return this; },
    once() { return this; },
  };
  return res;
};

/** Registers the path against a fake router and returns the express handler (the last
 *  argument passed to the route method, whatever middlewares precede it). */
const handlerFor = (svc: HttpHandlerService, path: PathDefinition) => {
  let handler: any;
  const router: any = {};
  router[path.method.toLowerCase()] = (_p: string, ...handlers: any[]) => { handler = handlers[handlers.length - 1]; };
  svc.registerPath(path, router);
  return handler;
};

const basePath = (over: Partial<PathDefinition> = {}): PathDefinition => ({
  name: 'p', method: 'POST', path: '/x', topic: 't', action: 'a', mode: 'rpc',
  dataSource: 'body', actions: [], headers: {}, forwardHeaders: {}, redirect: 0, ...over,
} as PathDefinition);

describe('HttpHandlerService — auth/auth gate', () => {
  it('allowAnonymous=true: skips enforcement entirely (no checkActions, request proceeds) even with auth+actions', async () => {
    const { svc, broker, auth } = mkService();
    auth.processAuthData.mockResolvedValue({ success: false }); // invalid/absent token
    const h = handlerFor(svc, basePath({ auth: 'p', actions: ['admin'], allowAnonymous: true }));
    const res = mkRes();
    await h(mkReq(), res);
    expect(auth.checkActions).not.toHaveBeenCalled();
    expect(broker.requestData).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('auth-only, invalid token: 401 and the broker is never called', async () => {
    const { svc, broker, auth } = mkService();
    auth.processAuthData.mockResolvedValue({ success: false });
    const h = handlerFor(svc, basePath({ auth: 'p' }));
    const res = mkRes();
    await h(mkReq(), res);
    expect(res.statusCode).toBe(401);
    expect(broker.requestData).not.toHaveBeenCalled();
  });

  it('auth-only, valid token: forwards mapped claims (without the success flag)', async () => {
    const { svc, broker, auth } = mkService();
    auth.processAuthData.mockResolvedValue({ success: true, 'X-GTW-AUTH-USERID': 'u1' });
    const h = handlerFor(svc, basePath({ auth: 'p' }));
    await h(mkReq(), mkRes());
    expect(broker.requestData).toHaveBeenCalledTimes(1);
    const forwardedHeaders = broker.requestData.mock.calls[0][3];
    expect(forwardedHeaders['X-GTW-AUTH-USERID']).toBe('u1');
    expect('success' in forwardedHeaders).toBe(false);
  });

  it('auth+actions, ACL denies: 403 and the broker is never called', async () => {
    const { svc, broker, auth } = mkService();
    auth.processAuthData.mockResolvedValue({ success: true, 'X-GTW-AUTH-USERID': 'u1' });
    auth.checkActions.mockResolvedValue(false);
    const h = handlerFor(svc, basePath({ auth: 'p', actions: ['admin'] }));
    const res = mkRes();
    await h(mkReq(), res);
    expect(res.statusCode).toBe(403);
    expect(broker.requestData).not.toHaveBeenCalled();
  });

  it('auth+actions, ACL store errors: 503 (fail-closed), never hangs, broker never called', async () => {
    const { svc, broker, auth } = mkService();
    auth.processAuthData.mockResolvedValue({ success: true, 'X-GTW-AUTH-USERID': 'u1' });
    auth.checkActions.mockRejectedValue(new Error('mongo down')); // ACL backend outage
    const h = handlerFor(svc, basePath({ auth: 'p', actions: ['admin'] }));
    const res = mkRes();
    await h(mkReq(), res); // must resolve (answer sent), not reject/hang
    expect(res.statusCode).toBe(503);
    expect(broker.requestData).not.toHaveBeenCalled();
  });

  it('auth+actions, ACL allows: forwards and returns 200', async () => {
    const { svc, broker, auth } = mkService();
    auth.processAuthData.mockResolvedValue({ success: true, 'X-GTW-AUTH-USERID': 'u1' });
    auth.checkActions.mockResolvedValue(true);
    const h = handlerFor(svc, basePath({ auth: 'p', actions: ['admin'] }));
    const res = mkRes();
    await h(mkReq(), res);
    expect(res.statusCode).toBe(200);
    expect(broker.requestData).toHaveBeenCalledTimes(1);
  });

  it('anti-spoofing: a client-forwarded header cannot override the auth-derived identity', async () => {
    const { svc, broker, auth } = mkService();
    auth.processAuthData.mockResolvedValue({ success: true, 'X-GTW-AUTH-USERID': 'real-user' });
    // forwardHeaders maps a client header onto the SAME final key as the auth claim
    // (gateway.headerPrefix 'X-GTW-AUTH-' + 'USERID'); the attacker sends it in the request.
    const h = handlerFor(svc, basePath({ auth: 'p', forwardHeaders: { USERID: 'x-evil' } }));
    await h(mkReq({ headers: { 'x-evil': 'attacker' } }), mkRes());
    const forwardedHeaders = broker.requestData.mock.calls[0][3];
    expect(forwardedHeaders['X-GTW-AUTH-USERID']).toBe('real-user');
  });
});

// The ACL resource context must come from the SAME payload the microservice receives, whatever the
// dataSource: otherwise a caller could get an id it holds authorized (e.g. in the query) while the
// microservice acts on another one (e.g. in the body). These tests use the REAL
// extractResourceContext so the whole gate → forward path is exercised.
describe('HttpHandlerService — ACL resource context = forwarded payload', () => {
  const withRealContext = () => {
    const ctx = mkService();
    ctx.auth.processAuthData.mockResolvedValue({ success: true, 'X-GTW-AUTH-USERID': 'u1' });
    ctx.auth.extractResourceContext.mockImplementation(HttpAuthHandlerService.prototype.extractResourceContext);
    return ctx;
  };
  // Every source carries a different value, so the test shows which one wins.
  const conflictingReq = () => mkReq({
    params: { resourceId: 'r-params' },
    query: { companyId: 'c-query', resourceId: 'r-query' },
    body: { companyId: 'c-body', resourceId: 'r-body' },
  });

  it.each<[BrokerHttpDataSource, string | undefined]>([
    ['body', 'c-body'],
    ['query', 'c-query'],
    ['params', undefined],
    ['body-query', 'c-body'],
    ['query-body', 'c-query'],
  ])("dataSource '%s': the ACL checks exactly the ids that are forwarded (companyId=%s, params win)", async (dataSource, companyId) => {
    const { svc, broker, auth } = withRealContext();
    const h = handlerFor(svc, basePath({ auth: 'p', actions: ['orders.write'], dataSource }));
    await h(conflictingReq(), mkRes());
    const forwarded = broker.requestData.mock.calls[0][2];
    const checkedCtx = auth.checkActions.mock.calls[0][2];
    expect(checkedCtx).toEqual({ companyId, resourceId: 'r-params' });
    expect({ companyId: forwarded.companyId, resourceId: forwarded.resourceId }).toEqual(checkedCtx);
  });

  it('a query id the caller holds cannot authorize a different body id (dataSource body): 403', async () => {
    const { svc, broker, auth } = withRealContext();
    // The caller holds the action on company MINE only.
    auth.checkActions.mockImplementation(async (_claims: any, _path: any, ctx: any) => ctx?.companyId === 'MINE');
    const h = handlerFor(svc, basePath({ auth: 'p', actions: ['orders.write'], dataSource: 'body' }));
    const res = mkRes();
    await h(mkReq({ query: { companyId: 'MINE' }, body: { companyId: 'VICTIM' } }), res);
    expect(res.statusCode).toBe(403);
    expect(broker.requestData).not.toHaveBeenCalled();
  });

  it('the id the caller holds, sent where the route reads it, is still authorized and forwarded', async () => {
    const { svc, broker, auth } = withRealContext();
    auth.checkActions.mockImplementation(async (_claims: any, _path: any, ctx: any) => ctx?.companyId === 'MINE');
    const h = handlerFor(svc, basePath({ auth: 'p', actions: ['orders.write'], dataSource: 'body' }));
    const res = mkRes();
    await h(mkReq({ body: { companyId: 'MINE' } }), res);
    expect(res.statusCode).toBe(200);
    expect(broker.requestData.mock.calls[0][2].companyId).toBe('MINE');
  });
});
