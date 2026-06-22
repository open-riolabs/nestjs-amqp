// jwks-rsa (transitively imported via JwtService) pulls in `jose` (ESM); stub it
// so Jest's CJS runtime can load the module graph.
jest.mock('jwks-rsa', () => ({
  JwksClient: class {
    constructor(_opts: any) { }
    getSigningKey(_kid: any, cb: any) { cb(new Error('no network in test')); }
  },
}));

import { HttpHandlerService } from './http-handler.service';
import { PathDefinition } from '../config/path-definition.config';

// End-to-end test of the gateway auth/authz gate as orchestrated by HttpHandlerService.
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

/** Registers the path against a fake router and returns the express handler. */
const handlerFor = (svc: HttpHandlerService, path: PathDefinition) => {
  let handler: any;
  const router: any = {};
  router[path.method.toLowerCase()] = (_p: string, _mw: any, h: any) => { handler = h; };
  svc.registerPath(path, router);
  return handler;
};

const basePath = (over: Partial<PathDefinition> = {}): PathDefinition => ({
  name: 'p', method: 'POST', path: '/x', topic: 't', action: 'a', mode: 'rpc',
  dataSource: 'body', actions: [], headers: {}, forwardHeaders: {}, redirect: 0, ...over,
} as PathDefinition);

describe('HttpHandlerService — auth/authz gate', () => {
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
