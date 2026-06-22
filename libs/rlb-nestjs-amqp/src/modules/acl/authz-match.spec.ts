import { grantMatchesResource } from './authz-match';

const grant = (over: any = {}): any => ({ userId: 'u1', roles: ['admin'], ...over });

describe('grantMatchesResource (exact-match, no wildcard)', () => {
  it('both ids absent on request AND grant → true (the only carve-out)', () => {
    expect(grantMatchesResource(grant(), undefined)).toBe(true);
    expect(grantMatchesResource(grant(), {})).toBe(true);
    expect(grantMatchesResource(grant({ companyId: undefined, resourceId: undefined }), {})).toBe(true);
  });

  it('exact (companyId, resourceId) match → true', () => {
    expect(grantMatchesResource(grant({ companyId: 'c1', resourceId: 'r1' }), { companyId: 'c1', resourceId: 'r1' })).toBe(true);
  });

  it('companyId differs → false', () => {
    expect(grantMatchesResource(grant({ companyId: 'c1', resourceId: 'r1' }), { companyId: 'c2', resourceId: 'r1' })).toBe(false);
  });

  it('resourceId differs → false', () => {
    expect(grantMatchesResource(grant({ companyId: 'c1', resourceId: 'r1' }), { companyId: 'c1', resourceId: 'r2' })).toBe(false);
  });

  it('request carries ids, grant is resource-less → false (no wildcard)', () => {
    expect(grantMatchesResource(grant(), { companyId: 'c1', resourceId: 'r1' })).toBe(false);
    expect(grantMatchesResource(grant(), { resourceId: 'r1' })).toBe(false);
  });

  it('grant carries ids, request is resource-less → false', () => {
    expect(grantMatchesResource(grant({ companyId: 'c1', resourceId: 'r1' }), {})).toBe(false);
  });

  it('normalizes undefined / null / empty-string as equal (all absent)', () => {
    expect(grantMatchesResource(grant({ companyId: null, resourceId: '' }), { companyId: undefined, resourceId: undefined })).toBe(true);
    expect(grantMatchesResource(grant({ companyId: 'c1', resourceId: null }), { companyId: 'c1', resourceId: '' })).toBe(true);
  });
});
