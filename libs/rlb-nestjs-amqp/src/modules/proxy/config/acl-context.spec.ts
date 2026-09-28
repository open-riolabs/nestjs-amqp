import { DEFAULT_ACL_CONTEXT_FIELDS, resolveAclContextFields } from './acl-context';

describe('resolveAclContextFields (gateway.aclContext)', () => {
  it('uses the canonical names when aclContext is absent', () => {
    expect(resolveAclContextFields(undefined)).toEqual({ companyId: 'companyId', resourceId: 'resourceId' });
    expect(resolveAclContextFields(null)).toEqual({ companyId: 'companyId', resourceId: 'resourceId' });
  });

  it('renames only the keys it sets; the others keep the canonical name', () => {
    expect(resolveAclContextFields({ resourceId: 'entityId' })).toEqual({ companyId: 'companyId', resourceId: 'entityId' });
    expect(resolveAclContextFields({ companyId: 'tenantId' })).toEqual({ companyId: 'tenantId', resourceId: 'resourceId' });
  });

  it('renames both keys and trims surrounding whitespace', () => {
    expect(resolveAclContextFields({ companyId: ' tenantId ', resourceId: 'entityId' }))
      .toEqual({ companyId: 'tenantId', resourceId: 'entityId' });
  });

  it('returns a fresh object (the defaults are never mutated)', () => {
    const fields = resolveAclContextFields(undefined);
    fields.resourceId = 'changed';
    expect(DEFAULT_ACL_CONTEXT_FIELDS.resourceId).toBe('resourceId');
  });

  it.each([
    ['a string', 'entityId'],
    ['an array', ['entityId']],
  ])('rejects %s instead of an object', (_label, config) => {
    expect(() => resolveAclContextFields(config)).toThrow(/must be an object/);
  });

  it('rejects an unknown key (e.g. a casing typo) instead of silently ignoring it', () => {
    expect(() => resolveAclContextFields({ resourceID: 'entityId' })).toThrow(/unknown key 'resourceID'/);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['null (empty YAML value)', null],
    ['undefined (e.g. an unset env var)', undefined],
    ['a number', 42],
  ])('rejects a %s field name', (_label, value) => {
    expect(() => resolveAclContextFields({ resourceId: value })).toThrow(/resourceId must be a non-empty string/);
  });

  it('rejects companyId and resourceId read from the same field', () => {
    expect(() => resolveAclContextFields({ companyId: 'id', resourceId: 'id' })).toThrow(/different fields/);
    // Also when an alias collides with the other key's canonical name.
    expect(() => resolveAclContextFields({ resourceId: 'companyId' })).toThrow(/different fields/);
  });
});
