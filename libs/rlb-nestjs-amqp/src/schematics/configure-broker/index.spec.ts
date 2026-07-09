import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { ConfigureBrokerOptions } from './schema';

/** Invoke the factory Rule directly (SchematicTestRunner eagerly loads ESM `ora`). */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: ConfigureBrokerOptions, tree: Tree): Promise<Tree> {
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
    ['# my config', 'broker:', '  uri: amqp://old', '  prefetchCount: 10', 'topics: []', ''].join('\n'),
  );
  return tree;
}

describe('configure-broker schematic', () => {
  it('sets only the provided scalars at their nested paths', async () => {
    const tree = await run(
      { uri: 'amqp://new', defaultRpcTimeout: 5000, heartbeatIntervalInSeconds: 15, mechanism: 'PLAIN', username: 'u', password: 'p' },
      seedConfig(),
    );
    const d = doc(tree);
    expect(String(d.getIn(['broker', 'uri']))).toBe('amqp://new');
    expect(Number(d.getIn(['broker', 'defaultRpcTimeout']))).toBe(5000);
    expect(Number(d.getIn(['broker', 'connectionManagerOptions', 'heartbeatIntervalInSeconds']))).toBe(15);
    const creds = ['broker', 'connectionManagerOptions', 'connectionOptions', 'credentials'];
    expect(String(d.getIn([...creds, 'mechanism']))).toBe('PLAIN');
    expect(String(d.getIn([...creds, 'username']))).toBe('u');
    expect(String(d.getIn([...creds, 'password']))).toBe('p');
    // Untouched pre-existing value survives.
    expect(Number(d.getIn(['broker', 'prefetchCount']))).toBe(10);
  });

  it('leaves unprovided keys untouched (no clobbering)', async () => {
    const tree = await run({ defaultRpcTimeout: 3000 }, seedConfig());
    const d = doc(tree);
    expect(String(d.getIn(['broker', 'uri']))).toBe('amqp://old');
    expect(Number(d.getIn(['broker', 'prefetchCount']))).toBe(10);
    expect(Number(d.getIn(['broker', 'defaultRpcTimeout']))).toBe(3000);
  });

  it('is idempotent and makes no change when no options are provided', async () => {
    const seed = seedConfig();
    const before = read(seed);
    const tree = await run({}, seed);
    expect(read(tree)).toBe(before);
  });
});
