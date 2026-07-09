import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddQueueOptions } from './schema';

/**
 * Invoke the factory Rule directly against a Tree (NOT SchematicTestRunner — it eagerly loads `ora`,
 * an ESM-only module jest cannot transform here). Passing `name` makes `flagsProvided` true, so no
 * interactive prompt is attempted.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: AddQueueOptions, tree: Tree): Promise<Tree> {
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

describe('add-queue schematic', () => {
  it('appends a new queue, preserving comments', async () => {
    const tree = await run({ name: 'orders', exchange: 'rlb' }, seedConfig());
    const queues = doc(tree).getIn(['broker', 'queues']) as any;
    expect(queues.items.map((i: any) => String(i.get('name')))).toEqual(['orders']);
    expect(String(queues.items[0].get('exchange'))).toBe('rlb');
    expect(read(tree)).toContain('# my config');
  });

  it('is idempotent: re-adding the same queue leaves a single entry', async () => {
    let tree = await run({ name: 'orders', exchange: 'rlb' }, seedConfig());
    tree = await run({ name: 'orders', exchange: 'rlb' }, tree);
    const queues = doc(tree).getIn(['broker', 'queues']) as any;
    const names = queues.items.map((i: any) => String(i.get('name')));
    expect(names.filter((n: string) => n === 'orders')).toHaveLength(1);
  });

  it('creates the missing exchange when createExchange is set', async () => {
    const tree = await run({ name: 'jobs', exchange: 'jobs-ex', createExchange: true, exchangeType: 'topic' }, seedConfig());
    const exchanges = doc(tree).getIn(['broker', 'exchanges']) as any;
    const created = exchanges.items.find((i: any) => String(i.get('name')) === 'jobs-ex');
    expect(created).toBeDefined();
    expect(String(created.get('type'))).toBe('topic');
  });

  it('defaults routingKey to the queue name for topic exchanges', async () => {
    const tree = await run({ name: 'jobs', exchange: 'jobs-ex', createExchange: true, exchangeType: 'topic' }, seedConfig());
    const queue = (doc(tree).getIn(['broker', 'queues']) as any).items[0];
    expect(String(queue.get('routingKey'))).toBe('jobs');
  });

  it('does not emit a routingKey for direct exchanges when none is given', async () => {
    const tree = await run({ name: 'orders', exchange: 'rlb' }, seedConfig());
    const queue = (doc(tree).getIn(['broker', 'queues']) as any).items[0];
    expect(queue.get('routingKey')).toBeUndefined();
  });

  it('creates config.yaml when it does not exist', async () => {
    const tree = await run({ name: 'orders', exchange: 'rlb' }, Tree.empty());
    expect(tree.exists('config/config.yaml')).toBe(true);
  });
});
