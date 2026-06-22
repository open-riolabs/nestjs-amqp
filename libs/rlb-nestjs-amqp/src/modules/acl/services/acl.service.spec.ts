import { AclService } from './acl.service';

const ROLES = [
  { name: 'admin', actions: ['role-management', 'booking-read'] },
  { name: 'viewer', actions: ['booking-read'] },
];
const GRANTS: Record<string, any[]> = {
  u1: [{ userId: 'u1', companyId: 'c1', resourceId: 'r1', roles: ['admin'] }],
  u2: [{ userId: 'u2', roles: ['viewer'] }], // resource-less (global) grant
};

const grantsRepo = () => ({ filter: async (f: any) => (GRANTS[f.userId] ?? []).map((r) => ({ ...r })) }) as any;
const rolesRepo = () => ({ list: jest.fn(async () => ROLES) }) as any;
const cacheFake = () => {
  const store = new Map<string, boolean>();
  return {
    get: jest.fn(async (u: string, a: string) => (store.has(`${u}::${a}`) ? store.get(`${u}::${a}`)! : null)),
    set: jest.fn(async (u: string, a: string, v: boolean) => { store.set(`${u}::${a}`, v); }),
  } as any;
};
const mk = () => new AclService(grantsRepo(), rolesRepo(), cacheFake());

describe('AclService.checkAction (single action-based primitive)', () => {
  it('exact (companyId, resourceId) + role-grants-the-action → true', async () => {
    expect(await mk().checkAction('u1', { companyId: 'c1', resourceId: 'r1' }, 'role-management')).toBe(true);
  });

  it('resource mismatch → false', async () => {
    expect(await mk().checkAction('u1', { companyId: 'c1', resourceId: 'r2' }, 'role-management')).toBe(false);
  });

  it('company mismatch → false', async () => {
    expect(await mk().checkAction('u1', { companyId: 'c2', resourceId: 'r1' }, 'role-management')).toBe(false);
  });

  it('ctx === undefined is resource-agnostic (matches the scoped grant)', async () => {
    expect(await mk().checkAction('u1', undefined, 'role-management')).toBe(true);
  });

  it('resource-less grant matches a resource-less request (both-absent carve-out)', async () => {
    expect(await mk().checkAction('u2', {}, 'booking-read')).toBe(true);
  });

  it('resource-less grant does NOT match a request carrying ids (no wildcard)', async () => {
    expect(await mk().checkAction('u2', { companyId: 'c1' }, 'booking-read')).toBe(false);
  });

  it('scoped grant does NOT match a resource-less request', async () => {
    expect(await mk().checkAction('u1', {}, 'role-management')).toBe(false);
  });

  it('unknown action (no role includes it) → false', async () => {
    expect(await mk().checkAction('u1', { companyId: 'c1', resourceId: 'r1' }, 'nope')).toBe(false);
  });

  it('action list has OR-semantics (any one suffices)', async () => {
    expect(await mk().checkAction('u1', { companyId: 'c1', resourceId: 'r1' }, ['nope', 'booking-read'])).toBe(true);
  });

  it('missing userId or empty action → false', async () => {
    expect(await mk().checkAction('', { companyId: 'c1', resourceId: 'r1' }, 'role-management')).toBe(false);
    expect(await mk().checkAction('u1', { companyId: 'c1', resourceId: 'r1' }, [])).toBe(false);
  });

  it('cache key encodes ctx: a true for ctx A is not served for ctx B', async () => {
    const svc = mk();
    expect(await svc.checkAction('u1', { companyId: 'c1', resourceId: 'r1' }, 'role-management')).toBe(true);
    expect(await svc.checkAction('u1', { companyId: 'c1', resourceId: 'r2' }, 'role-management')).toBe(false);
  });

  it('cache key distinguishes agnostic from both-absent', async () => {
    const svc = mk();
    expect(await svc.checkAction('u1', undefined, 'role-management')).toBe(true);  // agnostic
    expect(await svc.checkAction('u1', {}, 'role-management')).toBe(false);        // both-absent
  });

  it('serves a cached decision on the second identical call (resolves roles once)', async () => {
    const roles = rolesRepo();
    const svc = new AclService(grantsRepo(), roles, cacheFake());
    await svc.checkAction('u1', { companyId: 'c1', resourceId: 'r1' }, 'role-management');
    await svc.checkAction('u1', { companyId: 'c1', resourceId: 'r1' }, 'role-management');
    expect(roles.list).toHaveBeenCalledTimes(1);
  });
});

describe('AclService.handleCheckAction (acl-check-action RPC handler)', () => {
  it('maps body params (userId, action, companyId, resourceId) onto checkAction', async () => {
    const svc = mk();
    expect(await svc.handleCheckAction('u1', 'role-management', 'c1', 'r1')).toBe(true);
    expect(await svc.handleCheckAction('u1', ['nope', 'booking-read'], 'c1', 'r1')).toBe(true);
    expect(await svc.handleCheckAction('u1', 'role-management', 'c1', 'r2')).toBe(false);
  });
});
