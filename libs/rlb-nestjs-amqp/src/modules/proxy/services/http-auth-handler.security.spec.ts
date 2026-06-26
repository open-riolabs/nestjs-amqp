// jwks-rsa (transitively imported via JwtService) pulls in `jose` (ESM); stub it
// so Jest's CJS runtime can load the module graph.
jest.mock('jwks-rsa', () => ({
  JwksClient: class {
    constructor(_opts: any) { }
    getSigningKey(_kid: any, cb: any) { cb(new Error('no network in test')); }
  },
}));

import { HttpAuthHandlerService } from './http-auth-handler.service';

const make = () => new HttpAuthHandlerService(undefined as any, { find: () => undefined } as any, {} as any);
const req = (authorization?: string) => ({ headers: { authorization } } as any);
const basic = (u: string, p: string) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

describe('HttpAuthHandlerService — auth checks', () => {
  describe('str-compare', () => {
    it('passes through (success) when no secret is configured (provider effectively open)', async () => {
      const out = await make().checkStringCompare(req('anything'), { name: 'p', type: 'str-compare', headerPrefix: 'X-' } as any);
      expect(out.success).toBe(true);
    });

    it('accepts a matching secret', async () => {
      const out = await make().checkStringCompare(req('s3cr3t'), { name: 'p', type: 'str-compare', secret: 's3cr3t', headerPrefix: 'X-' } as any);
      expect(out.success).toBe(true);
    });

    it('rejects a wrong secret', async () => {
      const out = await make().checkStringCompare(req('nope'), { name: 'p', type: 'str-compare', secret: 's3cr3t', headerPrefix: 'X-' } as any);
      expect(out.success).toBe(false);
    });
  });

  describe('mapClaims — claim forwarding', () => {
    it('fail-safe: accepts the token (success) but forwards NO claims when jwtMap is absent', async () => {
      const out = make().mapClaims({ name: 'p', type: 'jwks', headerPrefix: 'X-GTW-AUTH-' } as any, { sub: 'u1', email: 'a@b.c', roles: ['x'] });
      expect(out.success).toBe(true);
      expect(Object.keys(out)).toEqual(['success']);
    });

    it('maps only the configured claims (prefixed, uppercased) when jwtMap is present', async () => {
      const out = make().mapClaims({ name: 'p', type: 'jwks', headerPrefix: 'X-GTW-AUTH-', jwtMap: ['sub:userId'] } as any, { sub: 'u1', email: 'a@b.c' });
      expect(out['X-GTW-AUTH-USERID']).toBe('u1');
      expect(out['X-GTW-AUTH-EMAIL']).toBeUndefined();
    });
  });

  describe('processAuthData — unknown provider', () => {
    it('fails closed (success:false) instead of throwing when the path references a missing provider', async () => {
      const out = await make().processAuthData(req('Bearer x') as any, { name: 'p', auth: 'does-not-exist' } as any);
      expect(out.success).toBe(false);
    });
  });

  describe('basic', () => {
    it('passes through (success) when no clientSecret is configured (provider effectively open)', async () => {
      const out = await make().checkBasicAuth(req(basic('admin', '')), { name: 'p', type: 'basic', headerPrefix: 'X-' } as any);
      expect(out.success).toBe(true);
    });

    it('accepts correct credentials', async () => {
      const out = await make().checkBasicAuth(req(basic('admin', 'pw')), { name: 'p', type: 'basic', clientId: 'admin', clientSecret: 'pw', headerPrefix: 'X-' } as any);
      expect(out.success).toBe(true);
    });

    it('rejects a wrong password', async () => {
      const out = await make().checkBasicAuth(req(basic('admin', 'bad')), { name: 'p', type: 'basic', clientId: 'admin', clientSecret: 'pw', headerPrefix: 'X-' } as any);
      expect(out.success).toBe(false);
    });
  });
});

const provider = { name: 'p', type: 'jwks', uidClaim: 'USERID', headerPrefix: 'X-GTW-AUTH-' } as any;
const makeWithAcl = (acl: any, providers: any[] = [provider]) =>
  new HttpAuthHandlerService(acl, { find: (n: string) => providers.find((p) => p.name === n) } as any, {} as any);

describe('HttpAuthHandlerService — action-based ACL (checkActions, HTTP path)', () => {
  const path = (over: any = {}) => ({ auth: 'p', actions: ['admin'], ...over } as any);

  it('authorizes a public path (no auth, no actions)', async () => {
    const ok = await makeWithAcl(undefined, []).checkActions({}, { } as any);
    expect(ok).toBe(true);
  });

  it('authorizes when the path declares no actions', async () => {
    const ok = await makeWithAcl(undefined).checkActions({}, path({ actions: [] }));
    expect(ok).toBe(true);
  });

  it('denies (fail closed) when actions are declared but the path has no auth provider', async () => {
    const acl = { checkAction: jest.fn() };
    const ok = await makeWithAcl(acl, []).checkActions({ 'X-GTW-AUTH-USERID': 'u1' }, { actions: ['admin'] } as any);
    expect(ok).toBe(false);
    expect(acl.checkAction).not.toHaveBeenCalled();
  });

  it('denies (does NOT throw) when no ACL service is registered', async () => {
    await expect(makeWithAcl(undefined).checkActions({ 'X-GTW-AUTH-USERID': 'u1' }, path())).resolves.toBe(false);
  });

  it('denies (does NOT throw) when the provider has no uidClaim', async () => {
    const acl = { checkAction: jest.fn() };
    const noUid = { name: 'p', type: 'jwks', headerPrefix: 'X-GTW-AUTH-' } as any; // uidClaim missing
    await expect(makeWithAcl(acl, [noUid]).checkActions({ 'X-GTW-AUTH-USERID': 'u1' }, path())).resolves.toBe(false);
    expect(acl.checkAction).not.toHaveBeenCalled();
  });

  it('denies (does NOT throw) when the path references an unknown provider', async () => {
    const acl = { checkAction: jest.fn() };
    await expect(makeWithAcl(acl, []).checkActions({ 'X-GTW-AUTH-USERID': 'u1' }, path())).resolves.toBe(false);
  });

  it('denies when claims carry no userId (no checkAction call)', async () => {
    const acl = { checkAction: jest.fn() };
    expect(await makeWithAcl(acl).checkActions({}, path())).toBe(false);
    expect(acl.checkAction).not.toHaveBeenCalled();
  });

  it('delegates to checkAction(userId, ctx, path.actions) and returns its verdict', async () => {
    const acl = { checkAction: jest.fn().mockResolvedValue(true) };
    const ctx = { companyId: 'c1', resourceId: 'r1' };
    const ok = await makeWithAcl(acl).checkActions({ 'X-GTW-AUTH-USERID': 'u1' }, path(), ctx);
    expect(ok).toBe(true);
    expect(acl.checkAction).toHaveBeenCalledWith('u1', ctx, ['admin']);
  });

  it('forwards an undefined ctx (resource-agnostic) when none is provided', async () => {
    const acl = { checkAction: jest.fn().mockResolvedValue(true) };
    await makeWithAcl(acl).checkActions({ 'X-GTW-AUTH-USERID': 'u1' }, path());
    expect(acl.checkAction).toHaveBeenCalledWith('u1', undefined, ['admin']);
  });

  it('returns false when the user holds none of the required actions', async () => {
    const acl = { checkAction: jest.fn().mockResolvedValue(false) };
    expect(await makeWithAcl(acl).checkActions({ 'X-GTW-AUTH-USERID': 'u1' }, path())).toBe(false);
  });
});

describe('HttpAuthHandlerService — action-based ACL (checkActionsForClaims, WS event)', () => {
  it('authorizes when no actions are required (does not touch the ACL service)', async () => {
    const acl = { checkAction: jest.fn() };
    expect(await makeWithAcl(acl).checkActionsForClaims(provider, { 'X-GTW-AUTH-USERID': 'u1' }, [])).toBe(true);
    expect(acl.checkAction).not.toHaveBeenCalled();
  });

  it('delegates to checkAction(userId, undefined, actions) — resource-agnostic — from mapped claims', async () => {
    const acl = { checkAction: jest.fn().mockResolvedValue(true) };
    const ok = await makeWithAcl(acl).checkActionsForClaims(provider, { 'X-GTW-AUTH-USERID': 'u1' }, ['orders.read']);
    expect(ok).toBe(true);
    expect(acl.checkAction).toHaveBeenCalledWith('u1', undefined, ['orders.read']);
  });

  it('denies an anonymous identity (no userId in claims) when actions are required', async () => {
    const acl = { checkAction: jest.fn() };
    expect(await makeWithAcl(acl).checkActionsForClaims(provider, {}, ['orders.read'])).toBe(false);
    expect(acl.checkAction).not.toHaveBeenCalled();
  });
});

describe('HttpAuthHandlerService — extractResourceContext', () => {
  const svc = () => makeWithAcl({ checkAction: jest.fn() });
  const rq = (over: any = {}) => ({ params: {}, query: {}, body: {}, ...over } as any);

  it('reads canonical companyId/resourceId with precedence params → query → body', () => {
    const ctx = svc().extractResourceContext(
      rq({ params: { resourceId: 'rP' }, query: { companyId: 'cQ', resourceId: 'rQ' }, body: { companyId: 'cB' } }),
    );
    expect(ctx).toEqual({ companyId: 'cQ', resourceId: 'rP' });
  });

  it('returns an object with undefined ids when none are present (exact-match still applies)', () => {
    expect(svc().extractResourceContext(rq())).toEqual({ companyId: undefined, resourceId: undefined });
  });
});
