import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddRouteOptions } from './schema';

/**
 * Schematics are tested by invoking the factory Rule directly against a Tree, NOT via
 * SchematicTestRunner (its testing entrypoint eagerly loads `ora`, an ESM-only module jest cannot
 * transform here). Passing `name` makes `flagsProvided` true, so no interactive prompt is attempted.
 */
function makeCtx(warnings: string[] = []): SchematicContext {
  return { logger: { info() {}, warn: (m: string) => warnings.push(m), error() {} } } as unknown as SchematicContext;
}

async function run(options: AddRouteOptions, tree: Tree, ctx = makeCtx()): Promise<Tree> {
  const rule = main(options) as Rule;
  const result = await (rule as (t: Tree, c: SchematicContext) => Promise<Tree>)(tree, ctx);
  return result || tree;
}

function read(tree: Tree, path = 'config/config.yaml'): string {
  return tree.read(path)!.toString('utf-8');
}
function doc(tree: Tree) {
  return parseDocument(read(tree));
}
function seedConfig(): Tree {
  const tree = Tree.empty();
  tree.create(
    'config/config.yaml',
    ['# my config', 'gateway:', '  paths:', '    - name: health', '      method: GET', '      path: /health', ''].join(
      '\n',
    ),
  );
  return tree;
}

describe('add-route schematic', () => {
  it('appends a POST route defaulting dataSource to body, preserving comments', async () => {
    const tree = await run({ name: 'create-order', method: 'POST', path: '/orders', topic: 'orders', action: 'create' }, seedConfig());
    const paths = doc(tree).getIn(['gateway', 'paths']) as any;
    expect(paths.items.map((i: any) => String(i.get('name')))).toEqual(['health', 'create-order']);
    const route = paths.items[1];
    expect(String(route.get('dataSource'))).toBe('body');
    expect(String(route.get('mode'))).toBe('rpc');
    expect(String(route.get('topic'))).toBe('orders');
    expect(read(tree)).toContain('# my config');
  });

  it('defaults GET routes to dataSource query and is idempotent', async () => {
    let tree = await run({ name: 'get-order', method: 'GET', path: '/orders/:id', topic: 'orders', action: 'get' }, seedConfig());
    const route = (doc(tree).getIn(['gateway', 'paths']) as any).items[1];
    expect(String(route.get('dataSource'))).toBe('query');
    tree = await run({ name: 'get-order', method: 'GET', path: '/orders/:id', topic: 'orders', action: 'get' }, tree);
    const names = (doc(tree).getIn(['gateway', 'paths']) as any).items.map((i: any) => String(i.get('name')));
    expect(names.filter((n: string) => n === 'get-order')).toHaveLength(1);
  });

  it('warns when actions are set without auth (ACL fails closed → 403)', async () => {
    const warnings: string[] = [];
    await run(
      { name: 'gated', method: 'GET', path: '/x', topic: 't', action: 'a', actions: ['gateway-access'] },
      seedConfig(),
      makeCtx(warnings),
    );
    expect(warnings.some((w) => w.includes('actions require auth'))).toBe(true);
  });

  it('creates config.yaml when it does not exist', async () => {
    const tree = await run({ name: 'health', method: 'GET', path: '/health', topic: 'admin', action: 'gw-health' }, Tree.empty());
    expect(tree.exists('config/config.yaml')).toBe(true);
    const route = (doc(tree).getIn(['gateway', 'paths']) as any).items[0];
    expect(String(route.get('name'))).toBe('health');
  });
});
