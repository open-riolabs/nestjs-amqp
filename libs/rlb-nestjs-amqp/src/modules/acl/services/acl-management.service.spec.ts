import { ForbiddenError } from '../../../common';
import { AclManagementService } from './acl-management.service';

// Minimal in-memory grant repo (only the methods grant/revoke/findGrant touch).
class FakeGrants {
  rows: any[] = [];
  private seq = 0;
  async filter(f: any) { return this.rows.filter((r) => r.userId === f.userId).map((r) => ({ ...r })); }
  async insert(m: any) { const row = { ...m, _id: `g${++this.seq}` }; this.rows.push(row); return { ...row }; }
  async updateById(id: string, patch: any) { const r = this.rows.find((x) => x._id === id); Object.assign(r, patch); return { ...r }; }
  async removeById(id: string) { const i = this.rows.findIndex((x) => x._id === id); const [r] = this.rows.splice(i, 1); return { ...r }; }
}

// assertRolesExist queries roles.filter({ name: { $in } }); treat every queried role as existing.
const rolesRepo = { filter: async (f: any) => (f?.name?.$in ?? []).map((name: string) => ({ name, actions: [] })) } as any;
const cache = { invalidate: jest.fn() } as any;

const mk = (acl: any, options: any = {}) => {
  const grants = new FakeGrants();
  const svc = new AclManagementService({} as any, rolesRepo, grants as any, cache, acl as any, options);
  return { svc, grants, acl };
};
const allow = () => ({ checkAction: jest.fn().mockResolvedValue(true) });
const deny = () => ({ checkAction: jest.fn().mockResolvedValue(false) });

describe('AclManagementService — grant/revoke admin gate', () => {
  it('grant ALLOWED when the caller holds role-management on the target', async () => {
    const { svc, acl } = mk(allow());
    const g = await svc.grant('u1', ['admin'], 'r1', 'c1', 'Friendly', 'caller');
    expect(acl.checkAction).toHaveBeenCalledWith('caller', { companyId: 'c1', resourceId: 'r1' }, 'role-management');
    expect(g).toMatchObject({ userId: 'u1', roles: ['admin'], companyId: 'c1', resourceId: 'r1' });
  });

  it('grant DENIED (ForbiddenError) when the caller lacks role-management', async () => {
    const { svc } = mk(deny());
    await expect(svc.grant('u1', ['admin'], 'r1', 'c1', 'F', 'caller')).rejects.toThrow(ForbiddenError);
  });

  it('revoke ALLOWED removes the role; DENIED throws', async () => {
    const { svc, grants } = mk(allow());
    await grants.insert({ userId: 'u1', companyId: 'c1', resourceId: 'r1', roles: ['admin', 'viewer'] });
    const r = await svc.revoke('u1', ['viewer'], 'r1', 'c1', 'caller');
    expect(r!.roles).toEqual(['admin']);

    const denied = mk(deny());
    await denied.grants.insert({ userId: 'u1', companyId: 'c1', resourceId: 'r1', roles: ['admin'] });
    await expect(denied.svc.revoke('u1', ['admin'], 'r1', 'c1', 'caller')).rejects.toThrow(ForbiddenError);
  });

  it('honors AclModuleOptions.roleManagementAction override', async () => {
    const { svc, acl } = mk(allow(), { roleManagementAction: 'mgmt' });
    await svc.grant('u1', ['admin'], 'r1', 'c1', undefined, 'caller');
    expect(acl.checkAction).toHaveBeenCalledWith('caller', { companyId: 'c1', resourceId: 'r1' }, 'mgmt');
  });

  it('grant identity is (userId, companyId, resourceId): different companyId → separate record; same triple → merge', async () => {
    const { svc, grants } = mk(allow());
    await svc.grant('u1', ['admin'], 'r1', 'c1', undefined, 'caller');
    await svc.grant('u1', ['viewer'], 'r1', 'c2', undefined, 'caller'); // different company → new record
    expect(grants.rows.filter((r) => r.userId === 'u1')).toHaveLength(2);

    await svc.grant('u1', ['editor'], 'r1', 'c1', undefined, 'caller'); // same triple → merge into c1
    const c1 = grants.rows.find((r) => r.companyId === 'c1');
    expect(new Set(c1.roles)).toEqual(new Set(['admin', 'editor']));
    expect(grants.rows.filter((r) => r.userId === 'u1')).toHaveLength(2);
  });
});
