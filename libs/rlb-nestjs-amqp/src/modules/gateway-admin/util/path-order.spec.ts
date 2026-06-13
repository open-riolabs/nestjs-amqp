import { comparePaths, orderPaths } from './path-order';

describe('path ordering (static before parametric)', () => {
  it('orders a static segment before a parametric one at the same level', () => {
    expect(comparePaths('/resources/path', '/resources/:varName')).toBeLessThan(0);
    expect(comparePaths('/resources/:varName', '/resources/path')).toBeGreaterThan(0);
  });

  it('orders static before param deeper in the path', () => {
    expect(comparePaths('/a/b/c', '/a/:b/c')).toBeLessThan(0);
  });

  it('orders a shorter prefix before a longer path', () => {
    expect(comparePaths('/a/b', '/a/:b/c')).toBeLessThan(0);
    expect(comparePaths('/a/b', '/a/b/c')).toBeLessThan(0);
  });

  it('orders param before wildcard', () => {
    expect(comparePaths('/a/:id', '/a/*')).toBeLessThan(0);
  });

  it('orders equal static segments lexicographically', () => {
    expect(comparePaths('/a/alpha', '/a/beta')).toBeLessThan(0);
  });

  it('orderPaths sorts a mixed list with statics first per level', () => {
    const input = [
      { path: '/resources/:varName' },
      { path: '/resources/path' },
      { path: '/resources/:varName/details' },
      { path: '/resources/path/details' },
    ];
    const ordered = orderPaths(input).map((p) => p.path);
    expect(ordered.indexOf('/resources/path')).toBeLessThan(ordered.indexOf('/resources/:varName'));
    expect(ordered.indexOf('/resources/path/details')).toBeLessThan(ordered.indexOf('/resources/:varName/details'));
  });
});
