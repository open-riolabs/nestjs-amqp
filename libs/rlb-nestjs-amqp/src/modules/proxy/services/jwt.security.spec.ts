// jwks-rsa pulls in `jose` (ESM), which Jest's CJS runtime can't parse. We don't
// need real JWKS fetching for these tests, so stub the client.
jest.mock('jwks-rsa', () => ({
  JwksClient: class {
    constructor(_opts: any) { }
    getSigningKey(_kid: any, cb: any) { cb(new Error('no network in test')); }
  },
}));

import * as jwt from 'jsonwebtoken';
import { JwtService } from './jwt.service';

describe('JwtService — algorithm hardening', () => {
  it('verifyTokenSecret denies when algorithms is missing (algorithm-confusion guard)', async () => {
    const svc = new JwtService([] as any);
    const out = await svc.verifyTokenSecret({ name: 'p', type: 'jwt', secret: 's', issuer: 'iss' } as any, 'token');
    expect(out).toBeUndefined();
  });

  it('verifyTokenSecret denies when secret is missing (fail-closed)', async () => {
    const svc = new JwtService([] as any);
    const out = await svc.verifyTokenSecret({ name: 'p', type: 'jwt', algorithms: ['HS256'], issuer: 'iss' } as any, 'token');
    expect(out).toBeUndefined();
  });

  it('verifyTokenSecret verifies a valid HS256 token when configured', async () => {
    const token = jwt.sign({ sub: 'u1' }, 'secret', { algorithm: 'HS256', issuer: 'iss' });
    const svc = new JwtService([] as any);
    const out: any = await svc.verifyTokenSecret({ name: 'p', type: 'jwt', secret: 'secret', algorithms: ['HS256'], issuer: 'iss' } as any, token);
    expect(out?.sub).toBe('u1');
  });

  it('verifyTokenJwks rejects symmetric algorithms (prevents RS->HS key confusion)', async () => {
    const cfg = { name: 'j', type: 'jwks', jwksUri: 'https://example.com/certs', algorithms: ['HS256'], issuer: 'iss' };
    const svc = new JwtService([cfg] as any);
    svc.onModuleInit(); // registers the jwks client (no network on construction)
    const out = await svc.verifyTokenJwks(cfg as any, 'token');
    expect(out).toBeUndefined();
  });
});
