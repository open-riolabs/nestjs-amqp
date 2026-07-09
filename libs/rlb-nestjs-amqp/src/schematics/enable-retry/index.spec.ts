import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { EnableRetryOptions } from './schema';

/** Invoke the factory Rule directly (SchematicTestRunner eagerly loads ESM `ora`). */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: EnableRetryOptions, tree: Tree): Promise<Tree> {
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
    ['# my config', 'broker:', '  exchanges:', '    - name: rlb', '      type: direct', 'topics:', '  - name: orders', '    mode: handle', ''].join('\n'),
  );
  return tree;
}

describe('enable-retry schematic', () => {
  it('sets broker.retry with the resolved onExhausted default', async () => {
    const tree = await run({ scope: 'broker', maxAttempts: 3, delayMs: 100 }, seedConfig());
    const retry = doc(tree).getIn(['broker', 'retry']) as any;
    expect(Number(retry.get('maxAttempts'))).toBe(3);
    expect(Number(retry.get('delayMs'))).toBe(100);
    expect(String(retry.get('onExhausted'))).toBe('drop'); // no DLX set
    expect(read(tree)).toContain('# my config');
  });

  it('is idempotent: re-running with the same values leaves broker.retry unchanged', async () => {
    let tree = await run({ scope: 'broker', maxAttempts: 5 }, seedConfig());
    const first = read(tree);
    tree = await run({ scope: 'broker', maxAttempts: 5 }, tree);
    expect(read(tree)).toBe(first);
  });

  it('declares the dead-letter exchange in broker.exchanges when dead-lettering', async () => {
    const tree = await run(
      { scope: 'broker', deadLetterExchange: 'rlb-dlx', deadLetterRoutingKey: 'dead' },
      seedConfig(),
    );
    const exchanges = doc(tree).getIn(['broker', 'exchanges']) as any;
    const names = exchanges.items.map((i: any) => String(i.get('name')));
    expect(names).toContain('rlb-dlx');
    const dlx = exchanges.items.find((i: any) => String(i.get('name')) === 'rlb-dlx');
    expect(String(dlx.get('type'))).toBe('topic');
    const retry = doc(tree).getIn(['broker', 'retry']) as any;
    expect(String(retry.get('onExhausted'))).toBe('dead-letter');
    expect(String(retry.getIn(['deadLetter', 'exchange']))).toBe('rlb-dlx');
    expect(String(retry.getIn(['deadLetter', 'routingKey']))).toBe('dead');
  });

  it('scope=topic sets topics[<name>].retry on the matching topic', async () => {
    const tree = await run({ scope: 'topic', topic: 'orders', maxAttempts: 2 }, seedConfig());
    const topic = (doc(tree).getIn(['topics']) as any).items.find((i: any) => String(i.get('name')) === 'orders');
    expect(Number(topic.getIn(['retry', 'maxAttempts']))).toBe(2);
  });

  it('scope=topic warns and makes no change when the topic is missing', async () => {
    const tree = await run({ scope: 'topic', topic: 'ghost', maxAttempts: 2 }, seedConfig());
    expect(doc(tree).getIn(['broker', 'retry'])).toBeUndefined();
  });
});
