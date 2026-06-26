// jwks-rsa (transitively imported via JwtService) pulls in `jose` (ESM); stub it for Jest's CJS runtime.
jest.mock('jwks-rsa', () => ({
  JwksClient: class { constructor(_o: any) { } getSigningKey(_k: any, cb: any) { cb(new Error('no network in test')); } },
}));

import { AuthProviderRegistry } from './auth-provider-registry.service';

const mkJwt = () => ({ resetClients: jest.fn() });
const mkSource = (enabled: any[]) => ({ listEnabled: jest.fn().mockResolvedValue(enabled) });

describe('AuthProviderRegistry', () => {
  it('starts from the YAML providers and resolves by name', () => {
    const reg = new AuthProviderRegistry([{ name: 'a' }, { name: 'b' }] as any, undefined, mkJwt() as any);
    expect(reg.find('a')).toEqual({ name: 'a' });
    expect(reg.find('zzz')).toBeUndefined();
    expect(reg.find()).toBeUndefined();
  });

  it('reload merges YAML + DB (DB overrides by name) from the source', async () => {
    const jwt = mkJwt();
    const source = mkSource([{ name: 'a', issuer: 'db' }, { name: 'c' }]);
    const reg = new AuthProviderRegistry([{ name: 'a', issuer: 'yaml' }, { name: 'b' }] as any, source as any, jwt as any);
    const n = await reg.reload();
    expect(n).toBe(3);
    expect(reg.find('a')).toEqual({ name: 'a', issuer: 'db' }); // DB wins on name conflict
    expect(reg.find('b')).toEqual({ name: 'b' });               // YAML-only kept
    expect(reg.find('c')).toEqual({ name: 'c' });               // DB-only added
    expect(jwt.resetClients).toHaveBeenCalled();
  });

  it('reload with no source keeps YAML only', async () => {
    const reg = new AuthProviderRegistry([{ name: 'a' }] as any, undefined, mkJwt() as any);
    await reg.reload();
    expect(reg.list().map((p: any) => p.name)).toEqual(['a']);
  });

  it('reload keeps the current set on a source failure (never throws)', async () => {
    const source = { listEnabled: jest.fn().mockRejectedValue(new Error('down')) };
    const reg = new AuthProviderRegistry([{ name: 'a' }] as any, source as any, mkJwt() as any);
    const n = await reg.reload();
    expect(n).toBe(1);
    expect(reg.find('a')).toEqual({ name: 'a' });
  });
});
