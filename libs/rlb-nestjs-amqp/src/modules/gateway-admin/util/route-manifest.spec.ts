import { diffRouteFields, isValidRoute, renderChanges, routeContent, routeKeyOf } from './route-manifest';

describe('route-manifest util', () => {
  it('routeKeyOf normalizes the method to uppercase', () => {
    expect(routeKeyOf({ method: 'get', path: '/x' })).toBe('GET /x');
  });

  it('routeContent is stable for the same route and differs when the content changes', () => {
    const base: any = { name: 'n', method: 'GET', path: '/x', dataSource: 'query', topic: 't', action: 'a', mode: 'rpc', actions: [], headers: {}, forwardHeaders: {} };
    expect(routeContent(base)).toBe(routeContent({ ...base }));
    expect(routeContent(base)).not.toBe(routeContent({ ...base, path: '/y' }));
    expect(routeContent(base)).not.toBe(routeContent({ ...base, actions: ['admin'] }));
  });

  it('routeContent ignores persistence/ownership fields (source, modified, owner, enabled, _id)', () => {
    const base: any = { name: 'n', method: 'GET', path: '/x', dataSource: 'query', topic: 't', action: 'a', mode: 'rpc', actions: [] };
    expect(routeContent(base)).toBe(routeContent({ ...base, source: 'user', modified: true, owner: 'svc', enabled: false, _id: '1' }));
  });

  it('routeContent is order-independent for object keys (deterministic)', () => {
    const base: any = { name: 'n', method: 'POST', path: '/x', dataSource: 'body', topic: 't', action: 'a', mode: 'rpc', actions: ['r1'], forwardHeaders: {} };
    expect(routeContent({ ...base, headers: { A: '1', B: '2' } })).toBe(routeContent({ ...base, headers: { B: '2', A: '1' } }));
  });

  it('isValidRoute requires method/path/topic/action and a valid mode', () => {
    expect(isValidRoute({ method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc' })).toBe(true);
    expect(isValidRoute({ method: 'GET', path: '/x', topic: 't', mode: 'rpc' })).toBe(false); // no action
    expect(isValidRoute({ method: 'GET', path: '/x', topic: 't', action: 'a' })).toBe(false); // no mode
    expect(isValidRoute({ method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'bad' })).toBe(false);
  });
});

describe('diffRouteFields / renderChanges', () => {
  it('diffs an array field as added/removed by value', () => {
    const changes = diffRouteFields({ actions: ['admin', 'viewer'] }, { actions: ['viewer', 'booking-read'] });
    expect(changes).toEqual([{ field: 'actions', added: ['booking-read'], removed: ['admin'] }]);
    expect(renderChanges(changes)).toBe('actions: [+booking-read, -admin]');
  });

  it('diffs a scalar field as +new / -old', () => {
    const changes = diffRouteFields({ timeout: 5000 }, { timeout: 1000 });
    expect(changes).toEqual([{ field: 'timeout', added: [1000], removed: [5000] }]);
    expect(renderChanges(changes)).toBe('timeout: [+1000, -5000]');
  });

  it('handles set→unset and unset→set', () => {
    expect(diffRouteFields({ timeout: 5000 }, {})).toEqual([{ field: 'timeout', added: [], removed: [5000] }]);
    expect(diffRouteFields({}, { timeout: 1000 })).toEqual([{ field: 'timeout', added: [1000], removed: [] }]);
    expect(renderChanges(diffRouteFields({ timeout: 5000 }, {}))).toBe('timeout: [-5000]');
  });

  it('returns [] when nothing route-relevant changed (ignores _id/owner/enabled/source/modified)', () => {
    const r = { method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', actions: ['x'] };
    expect(diffRouteFields(r, { ...r, _id: '1', owner: 'svc', enabled: false, source: 'user', modified: true })).toEqual([]);
  });
});
