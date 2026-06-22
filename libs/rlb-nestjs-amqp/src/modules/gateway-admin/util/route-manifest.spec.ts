import { isValidRoute, routeContent, routeKeyOf } from './route-manifest';

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
