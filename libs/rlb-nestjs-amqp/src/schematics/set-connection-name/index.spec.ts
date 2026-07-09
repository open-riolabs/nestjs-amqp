import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { SetConnectionNameOptions } from './schema';

/** Invoke the factory Rule directly (SchematicTestRunner eagerly loads ESM `ora`). */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: SetConnectionNameOptions, tree: Tree): Promise<Tree> {
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
const PATH = ['broker', 'connectionManagerOptions', 'connectionOptions', 'clientProperties', 'connection_name'];

function seedConfig(): Tree {
  const tree = Tree.empty();
  tree.create('config/config.yaml', ['# my config', 'broker:', '  uri: amqp://localhost', 'topics: []', ''].join('\n'));
  return tree;
}

describe('set-connection-name schematic', () => {
  it('sets the nested connection_name, trimming but not normalizing', async () => {
    const tree = await run({ name: '  My Service  ' }, seedConfig());
    expect(String(doc(tree).getIn(PATH))).toBe('My Service');
    expect(read(tree)).toContain('# my config');
  });

  it('is idempotent: re-running with the same value leaves the file unchanged', async () => {
    let tree = await run({ name: 'my-service' }, seedConfig());
    const first = read(tree);
    tree = await run({ name: 'my-service' }, tree);
    expect(read(tree)).toBe(first);
  });

  it('creates the full nested path when missing', async () => {
    const tree = await run({ name: 'gateway' }, Tree.empty());
    expect(tree.exists('config/config.yaml')).toBe(true);
    expect(String(doc(tree).getIn(PATH))).toBe('gateway');
  });
});
