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
});
