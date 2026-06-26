import { diffRoutes } from './route-diff';
import { routeKeyOf } from './route-manifest';

const route = (over: any = {}): any => ({ method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', actions: [], ...over });

describe('diffRoutes', () => {
  it('inserts new routes (changed=true, added=true, no existingId)', () => {
    const d = diffRoutes('svc', [route()], [], new Map());
    expect(d.upserts).toHaveLength(1);
    expect(d.upserts[0]).toMatchObject({ added: true, existingId: undefined });
    expect(d.upserts[0].model.owner).toBe('svc');
    expect(d.changed).toBe(true);
  });

  it('skips an unchanged route (same content)', () => {
    const r = route();
    const ex = { _id: '1', owner: 'svc', enabled: true, routeKey: routeKeyOf(r), ...r };
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts).toHaveLength(0);
    expect(d.changed).toBe(false);
  });

  it('updates a changed route (existingId set, added=false)', () => {
    const r = route({ actions: ['admin'] });
    const ex = { _id: '1', owner: 'svc', enabled: true, routeKey: routeKeyOf(r), ...route() }; // actions: []
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts).toHaveLength(1);
    expect(d.upserts[0]).toMatchObject({ existingId: '1', added: false });
    expect(d.changed).toBe(true);
  });

  it('re-enables a soft-disabled route present in the manifest', () => {
    const r = route();
    const ex = { _id: '1', owner: 'svc', enabled: false, routeKey: routeKeyOf(r), ...r };
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts).toHaveLength(1);
    expect(d.upserts[0].model.enabled).toBe(true);
  });

  it('soft-disables stale rows absent from the manifest', () => {
    const ex = { _id: '9', owner: 'svc', enabled: true, routeKey: 'DELETE /gone', method: 'DELETE', path: '/gone' };
    const d = diffRoutes('svc', [], [ex], new Map());
    expect(d.disables).toEqual([{ id: '9', routeKey: 'DELETE /gone', method: 'DELETE', path: '/gone' }]);
    expect(d.changed).toBe(true);
  });

  it('skips + flags a route reserved by another owner (collision)', () => {
    const d = diffRoutes('svc', [route()], [], new Map([['GET /x', 'other-svc']]));
    expect(d.upserts).toHaveLength(0);
    expect(d.collisions).toEqual([{ routeKey: 'GET /x', method: 'GET', path: '/x', conflictWith: 'other-svc' }]);
  });

  it('does NOT treat the service\'s own reserved key as a collision', () => {
    const d = diffRoutes('svc', [route()], [], new Map([['GET /x', 'svc']]));
    expect(d.collisions).toHaveLength(0);
    expect(d.upserts).toHaveLength(1);
  });

  it('drops invalid routes', () => {
    const d = diffRoutes('svc', [route({ topic: undefined }), route({ mode: 'weird' })], [], new Map());
    expect(d.invalid).toHaveLength(2);
    expect(d.upserts).toHaveLength(0);
  });

  it('dedupes duplicate route keys within a manifest (first wins)', () => {
    const d = diffRoutes('svc', [route(), route({ actions: ['x'] })], [], new Map());
    expect(d.upserts).toHaveLength(1);
  });

  it('marks inserted routes source=microservice, modified=false', () => {
    const d = diffRoutes('svc', [route()], [], new Map());
    expect(d.upserts[0].model).toMatchObject({ source: 'microservice', modified: false });
  });

  it('skips a user-modified route (modified=true): no upsert, recorded in skipped, not changed', () => {
    const r = route({ actions: ['x'] }); // manifest carries a different version
    const ex = { _id: '1', owner: 'svc', enabled: true, modified: true, routeKey: routeKeyOf(r), ...route() };
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts).toHaveLength(0);
    expect(d.skipped).toEqual([{ routeKey: 'GET /x', method: 'GET', path: '/x' }]);
    expect(d.changed).toBe(false);
  });

  it('an updated route carries a per-field changes diff; an added route does not', () => {
    const r = route({ actions: ['admin'] });
    const ex = { _id: '1', owner: 'svc', enabled: true, routeKey: routeKeyOf(r), ...route() }; // actions: []
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts[0].changes).toEqual([{ field: 'actions', added: ['admin'], removed: [] }]);
    expect(diffRoutes('svc', [route()], [], new Map()).upserts[0].changes).toBeUndefined();
  });

  // --- soft per-field user overrides (userOverrides) -------------------------------
  it('preserves a user-overridden field (timeout) while still applying the MS change to other fields', () => {
    const r = route({ action: 'a2', timeout: 1000 });   // MS changed action AND timeout
    const ex = { _id: '1', owner: 'svc', enabled: true, routeKey: routeKeyOf(r), userOverrides: ['timeout'], ...route({ action: 'a1', timeout: 9000 }) };
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts).toHaveLength(1);
    expect(d.upserts[0].model.action).toBe('a2');   // MS change applied
    expect(d.upserts[0].model.timeout).toBe(9000);  // user override preserved
    expect(d.upserts[0].model.userOverrides).toEqual(['timeout']);
  });

  it('does NOT upsert when the MS changes ONLY a user-overridden field', () => {
    const r = route({ timeout: 1000 });
    const ex = { _id: '1', owner: 'svc', enabled: true, routeKey: routeKeyOf(r), userOverrides: ['timeout'], ...route({ timeout: 9000 }) };
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts).toHaveLength(0);
    expect(d.changed).toBe(false);
  });

  it('keeps a user-disabled route OFF (enabled override) while applying MS content changes', () => {
    const r = route({ action: 'a2' });
    const ex = { _id: '1', owner: 'svc', enabled: false, routeKey: routeKeyOf(r), userOverrides: ['enabled'], ...route({ action: 'a1' }) };
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts).toHaveLength(1);
    expect(d.upserts[0].model.enabled).toBe(false);  // stays OFF (user override)
    expect(d.upserts[0].model.action).toBe('a2');    // MS change applied
  });

  it('does NOT re-enable a user-disabled route (enabled override) when nothing else changed', () => {
    const r = route();
    const ex = { _id: '1', owner: 'svc', enabled: false, routeKey: routeKeyOf(r), userOverrides: ['enabled'], ...r };
    const d = diffRoutes('svc', [r], [ex], new Map());
    expect(d.upserts).toHaveLength(0);
  });
});
