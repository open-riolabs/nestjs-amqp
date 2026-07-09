import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddMetricsTopicOptions } from './schema';

/**
 * Factory is invoked directly against a Tree (not SchematicTestRunner, whose testing entrypoint
 * eagerly loads the ESM-only `ora`). Passing `topic` makes `flagsProvided` true → no prompts.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: AddMetricsTopicOptions, tree: Tree): Promise<Tree> {
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
    ['# my config', 'broker:', '  queues: []', 'topics: []', 'gateway:', '  paths: []', ''].join('\n'),
  );
  return tree;
}

describe('add-metrics-topic schematic', () => {
  it('creates a bounded queue, a handle topic and points gateway.metrics at it', async () => {
    const tree = await run({ topic: 'rlb-gateway-metrics' }, seedConfig());
    const d = doc(tree);

    const queue = (d.getIn(['broker', 'queues']) as any).items[0];
    expect(String(queue.get('name'))).toBe('rlb-gateway-metrics');
    expect(String(queue.get('exchange'))).toBe('rlb');
    expect(String(queue.get('routingKey'))).toBe('rlb-gateway-metrics');
    const qOpts = queue.get('options');
    expect(Number(qOpts.get('messageTtl'))).toBe(3600000);
    expect(Number(qOpts.get('maxLength'))).toBe(500000);

    const topic = (d.getIn(['topics']) as any).items[0];
    expect(String(topic.get('name'))).toBe('rlb-gateway-metrics');
    expect(String(topic.get('mode'))).toBe('handle');
    expect(String(topic.get('queue'))).toBe('rlb-gateway-metrics');

    expect(String(d.getIn(['gateway', 'metrics', 'topic']))).toBe('rlb-gateway-metrics');
    expect(String(d.getIn(['gateway', 'metrics', 'action']))).toBe('gw-metrics-track');
    expect(read(tree)).toContain('# my config');
  });

  it('honours an explicit queue name and custom bounds/action', async () => {
    const tree = await run(
      { topic: 'metrics-t', queue: 'metrics-q', exchange: 'ex', messageTtl: 60000, maxLength: 100, action: 'track' },
      seedConfig(),
    );
    const d = doc(tree);
    const queue = (d.getIn(['broker', 'queues']) as any).items[0];
    expect(String(queue.get('name'))).toBe('metrics-q');
    expect(String(queue.get('exchange'))).toBe('ex');
    expect(Number(queue.get('options').get('messageTtl'))).toBe(60000);
    expect(String(d.getIn(['topics'] as any) && (d.getIn(['topics']) as any).items[0].get('queue'))).toBe('metrics-q');
    expect(String(d.getIn(['gateway', 'metrics', 'action']))).toBe('track');
  });

  it('is idempotent: re-running leaves a single queue/topic entry', async () => {
    let tree = await run({ topic: 'rlb-gateway-metrics' }, seedConfig());
    tree = await run({ topic: 'rlb-gateway-metrics' }, tree);
    const d = doc(tree);
    const queues = (d.getIn(['broker', 'queues']) as any).items.map((i: any) => String(i.get('name')));
    const topics = (d.getIn(['topics']) as any).items.map((i: any) => String(i.get('name')));
    expect(queues.filter((n: string) => n === 'rlb-gateway-metrics')).toHaveLength(1);
    expect(topics.filter((n: string) => n === 'rlb-gateway-metrics')).toHaveLength(1);
  });
});
