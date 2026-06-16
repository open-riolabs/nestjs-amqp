// jwks-rsa (transitively imported via JwtService) pulls in `jose` (ESM); stub it
// so Jest's CJS runtime can load the module graph.
jest.mock('jwks-rsa', () => ({
  JwksClient: class {
    constructor(_opts: any) { }
    getSigningKey(_kid: any, cb: any) { cb(new Error('no network in test')); }
  },
}));

import { HttpAuthHandlerService } from './http-auth-handler.service';

const make = () => new HttpAuthHandlerService(undefined as any, [], {} as any);
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
  new HttpAuthHandlerService(acl, providers as any, {} as any);

describe('HttpAuthHandlerService — role-based ACL (checkRoles, HTTP path)', () => {
  const path = (over: any = {}) => ({ auth: 'p', roles: ['admin'], ...over } as any);

  it('authorizes a public path (no auth, no roles)', async () => {
    const ok = await makeWithAcl(undefined, []).checkRoles({}, { } as any);
    expect(ok).toBe(true);
  });

  it('authorizes when the path declares no roles', async () => {
    const ok = await makeWithAcl(undefined).checkRoles({}, path({ roles: [] }));
    expect(ok).toBe(true);
  });

  it('denies (fail closed) when roles are declared but the path has no auth provider', async () => {
    const acl = { canUserDoGtw: jest.fn(), canUserDo: jest.fn() };
    const ok = await makeWithAcl(acl, []).checkRoles({ 'X-GTW-AUTH-USERID': 'u1' }, { roles: ['admin'] } as any);
    expect(ok).toBe(false);
    expect(acl.canUserDoGtw).not.toHaveBeenCalled();
  });

  it('throws when roles are required but no ACL role service is registered', async () => {
    await expect(makeWithAcl(undefined).checkRoles({ 'X-GTW-AUTH-USERID': 'u1' }, path()))
      .rejects.toThrow(/ACL Role Service not found/);
  });

  it('denies when claims carry no userId (no canUserDoGtw call)', async () => {
    const acl = { canUserDoGtw: jest.fn(), canUserDo: jest.fn() };
    expect(await makeWithAcl(acl).checkRoles({}, path())).toBe(false);
    expect(acl.canUserDoGtw).not.toHaveBeenCalled();
  });

  it('delegates to canUserDoGtw(path.roles, userId) and returns its verdict', async () => {
    const acl = { canUserDoGtw: jest.fn().mockResolvedValue(true), canUserDo: jest.fn() };
    const ok = await makeWithAcl(acl).checkRoles({ 'X-GTW-AUTH-USERID': 'u1' }, path());
    expect(ok).toBe(true);
    expect(acl.canUserDoGtw).toHaveBeenCalledWith(['admin'], 'u1');
  });

  it('returns false when the user holds none of the required roles', async () => {
    const acl = { canUserDoGtw: jest.fn().mockResolvedValue(false), canUserDo: jest.fn() };
    expect(await makeWithAcl(acl).checkRoles({ 'X-GTW-AUTH-USERID': 'u1' }, path())).toBe(false);
  });
});

describe('HttpAuthHandlerService — role-based ACL (checkRolesForClaims, WS event)', () => {
  it('authorizes when no roles are required (does not touch the ACL service)', async () => {
    const acl = { canUserDoGtw: jest.fn(), canUserDo: jest.fn() };
    expect(await makeWithAcl(acl).checkRolesForClaims(provider, { 'X-GTW-AUTH-USERID': 'u1' }, [])).toBe(true);
    expect(acl.canUserDoGtw).not.toHaveBeenCalled();
  });

  it('delegates to canUserDoGtw(roles, userId) from mapped claims', async () => {
    const acl = { canUserDoGtw: jest.fn().mockResolvedValue(true), canUserDo: jest.fn() };
    const ok = await makeWithAcl(acl).checkRolesForClaims(provider, { 'X-GTW-AUTH-USERID': 'u1' }, ['orders.read']);
    expect(ok).toBe(true);
    expect(acl.canUserDoGtw).toHaveBeenCalledWith(['orders.read'], 'u1');
  });

  it('denies an anonymous identity (no userId in claims) when roles are required', async () => {
    const acl = { canUserDoGtw: jest.fn(), canUserDo: jest.fn() };
    expect(await makeWithAcl(acl).checkRolesForClaims(provider, {}, ['orders.read'])).toBe(false);
    expect(acl.canUserDoGtw).not.toHaveBeenCalled();
  });
});
