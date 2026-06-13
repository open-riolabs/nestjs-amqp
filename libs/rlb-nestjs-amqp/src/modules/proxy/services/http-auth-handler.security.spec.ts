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
