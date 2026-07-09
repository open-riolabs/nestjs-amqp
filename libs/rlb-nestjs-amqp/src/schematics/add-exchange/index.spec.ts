import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddExchangeOptions } from './schema';

/**
 * Schematics are tested by invoking the factory Rule directly against a Tree, NOT via
 * SchematicTestRunner (its testing entrypoint eagerly loads `ora`, an ESM-only module jest cannot
 * transform here). Passing `name` makes `flagsProvided` true, so no interactive prompt is attempted.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: AddExchangeOptions, tree: Tree): Promise<Tree> {
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

describe('add-exchange schematic', () => {
  it('appends a new exchange, preserving the existing one and comments', async () => {
    const tree = await run({ name: 'events', type: 'fanout' }, seedConfig());
    const exchanges = doc(tree).getIn(['broker', 'exchanges']) as any;
    expect(exchanges.items.map((i: any) => String(i.get('name')))).toEqual(['rlb', 'events']);
    expect(String(exchanges.items[1].get('type'))).toBe('fanout');
    expect(read(tree)).toContain('# my config');
  });

  it('is idempotent: re-adding the same exchange leaves a single entry', async () => {
    let tree = await run({ name: 'events', type: 'fanout' }, seedConfig());
    tree = await run({ name: 'events', type: 'fanout' }, tree);
    const exchanges = doc(tree).getIn(['broker', 'exchanges']) as any;
    const names = exchanges.items.map((i: any) => String(i.get('name')));
    expect(names.filter((n: string) => n === 'events')).toHaveLength(1);
  });

  it('with withQueue creates a bound queue (routingKey only for topic exchanges)', async () => {
    const tree = await run({ name: 'jobs', type: 'topic', withQueue: true, queueName: 'jobs-q' }, seedConfig());
    const queue = (doc(tree).getIn(['broker', 'queues']) as any).items[0];
    expect(String(queue.get('name'))).toBe('jobs-q');
    expect(String(queue.get('exchange'))).toBe('jobs');
    expect(String(queue.get('routingKey'))).toBe('jobs-q');
  });

  it('creates config.yaml when it does not exist', async () => {
    const tree = await run({ name: 'rlb', type: 'direct' }, Tree.empty());
    expect(tree.exists('config/config.yaml')).toBe(true);
    const exchanges = doc(tree).getIn(['broker', 'exchanges']) as any;
    expect(String(exchanges.items[0].get('name'))).toBe('rlb');
  });
});
