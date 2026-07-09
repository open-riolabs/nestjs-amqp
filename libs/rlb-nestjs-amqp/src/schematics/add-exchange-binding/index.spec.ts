import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddExchangeBindingOptions } from './schema';

/**
 * Invoke the factory Rule directly against a Tree (NOT SchematicTestRunner — it eagerly loads `ora`,
 * an ESM-only module jest cannot transform here). Passing `source` makes `flagsProvided` true, so no
 * interactive prompt is attempted.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: AddExchangeBindingOptions, tree: Tree): Promise<Tree> {
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
    ['# my config', 'broker:', '  exchanges:', '    - name: rlb', '      type: direct', 'topics: []', ''].join('\n'),
  );
  return tree;
}

describe('add-exchange-binding schematic', () => {
  it('appends a new binding, preserving comments', async () => {
    const tree = await run({ source: 'rlb', destination: 'audit', pattern: 'order.*' }, seedConfig());
    const bindings = doc(tree).getIn(['broker', 'exchangeBindings']) as any;
    expect(bindings.items).toHaveLength(1);
    expect(String(bindings.items[0].get('source'))).toBe('rlb');
    expect(String(bindings.items[0].get('destination'))).toBe('audit');
    expect(String(bindings.items[0].get('pattern'))).toBe('order.*');
    expect(read(tree)).toContain('# my config');
  });

  it('is idempotent: re-adding the same triple leaves a single entry', async () => {
    let tree = await run({ source: 'rlb', destination: 'audit', pattern: 'order.*' }, seedConfig());
    tree = await run({ source: 'rlb', destination: 'audit', pattern: 'order.*' }, tree);
    const bindings = doc(tree).getIn(['broker', 'exchangeBindings']) as any;
    expect(bindings.items).toHaveLength(1);
  });

  it('treats a different pattern as a distinct binding', async () => {
    let tree = await run({ source: 'rlb', destination: 'audit', pattern: 'order.*' }, seedConfig());
    tree = await run({ source: 'rlb', destination: 'audit', pattern: 'user.*' }, tree);
    const bindings = doc(tree).getIn(['broker', 'exchangeBindings']) as any;
    expect(bindings.items).toHaveLength(2);
  });

  it('updates fields on an existing binding only when overwrite is set', async () => {
    let tree = await run({ source: 'rlb', destination: 'audit', pattern: 'order.*' }, seedConfig());
    tree = await run(
      { source: 'rlb', destination: 'audit', pattern: 'order.*', args: { 'x-match': 'all' }, overwrite: true },
      tree,
    );
    const binding = (doc(tree).getIn(['broker', 'exchangeBindings']) as any).items[0];
    expect((binding.get('args') as any).get('x-match')).toBe('all');
  });

  it('creates config.yaml when it does not exist', async () => {
    const tree = await run({ source: 'rlb', destination: 'audit', pattern: 'order.*' }, Tree.empty());
    expect(tree.exists('config/config.yaml')).toBe(true);
  });
});
