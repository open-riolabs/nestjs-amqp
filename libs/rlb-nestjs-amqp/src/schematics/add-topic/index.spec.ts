import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddTopicOptions } from './schema';

/**
 * Invoke the factory Rule directly against a Tree (NOT SchematicTestRunner — it eagerly loads `ora`,
 * an ESM-only module jest cannot transform here). Passing `name` makes `flagsProvided` true, so no
 * interactive prompt is attempted.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: AddTopicOptions, tree: Tree): Promise<Tree> {
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

describe('add-topic schematic', () => {
  it('appends a new topic, preserving comments', async () => {
    const tree = await run({ name: 'get-user', mode: 'rpc', queue: 'get-user-q' }, seedConfig());
    const topics = doc(tree).getIn(['topics']) as any;
    expect(topics.items.map((i: any) => String(i.get('name')))).toEqual(['get-user']);
    expect(String(topics.items[0].get('mode'))).toBe('rpc');
    expect(read(tree)).toContain('# my config');
  });

  it('is idempotent: re-adding the same topic leaves a single entry', async () => {
    let tree = await run({ name: 'get-user', mode: 'rpc', queue: 'get-user-q' }, seedConfig());
    tree = await run({ name: 'get-user', mode: 'rpc', queue: 'get-user-q' }, tree);
    const topics = doc(tree).getIn(['topics']) as any;
    const names = topics.items.map((i: any) => String(i.get('name')));
    expect(names.filter((n: string) => n === 'get-user')).toHaveLength(1);
  });

  it('creates the consuming queue for rpc mode', async () => {
    const tree = await run({ name: 'get-user', mode: 'rpc', queue: 'get-user-q' }, seedConfig());
    const queues = doc(tree).getIn(['broker', 'queues']) as any;
    const queue = queues.items.find((i: any) => String(i.get('name')) === 'get-user-q');
    expect(queue).toBeDefined();
    expect(String(queue.get('exchange'))).toBe('rlb');
    const topic = (doc(tree).getIn(['topics']) as any).items[0];
    expect(String(topic.get('queue'))).toBe('get-user-q');
  });

  it('does not require a queue for broadcast mode but binds the exchange', async () => {
    const tree = await run({ name: 'announce', mode: 'broadcast', exchange: 'events' }, seedConfig());
    const topic = (doc(tree).getIn(['topics']) as any).items[0];
    expect(String(topic.get('mode'))).toBe('broadcast');
    expect(String(topic.get('exchange'))).toBe('events');
    expect(topic.get('queue')).toBeUndefined();
    const exchanges = doc(tree).getIn(['broker', 'exchanges']) as any;
    expect(exchanges.items.map((i: any) => String(i.get('name')))).toContain('events');
  });

  it('builds a retry object only when a retry flag is provided', async () => {
    const tree = await run(
      { name: 'flaky', mode: 'handle', queue: 'flaky-q', retryMaxAttempts: 5, retryDelayMs: 1000, retryOnExhausted: 'drop' },
      seedConfig(),
    );
    const topic = (doc(tree).getIn(['topics']) as any).items[0];
    const retry = topic.get('retry') as any;
    expect(Number(retry.get('maxAttempts'))).toBe(5);
    expect(Number(retry.get('delayMs'))).toBe(1000);
    expect(String(retry.get('onExhausted'))).toBe('drop');
    expect(retry.get('deadLetter')).toBeUndefined();
  });

  it('omits retry entirely when no retry flag is given', async () => {
    const tree = await run({ name: 'get-user', mode: 'rpc', queue: 'get-user-q' }, seedConfig());
    const topic = (doc(tree).getIn(['topics']) as any).items[0];
    expect(topic.get('retry')).toBeUndefined();
  });

  it('defaults routingKey to the topic name for topic exchanges', async () => {
    const seed = Tree.empty();
    seed.create(
      'config/config.yaml',
      ['broker:', '  exchanges:', '    - name: rlb', '      type: topic', 'topics: []', ''].join('\n'),
    );
    const tree = await run({ name: 'get-user', mode: 'rpc', queue: 'get-user-q', exchange: 'rlb' }, seed);
    const topic = (doc(tree).getIn(['topics']) as any).items[0];
    expect(String(topic.get('routingKey'))).toBe('get-user');
  });
});
