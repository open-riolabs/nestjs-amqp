import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddReplyQueueOptions } from './schema';

/**
 * Invoke the factory Rule directly against a Tree (NOT SchematicTestRunner — it eagerly loads `ora`,
 * an ESM-only module jest cannot transform here). Passing `exchange` makes `flagsProvided` true, so no
 * interactive prompt is attempted.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: AddReplyQueueOptions, tree: Tree): Promise<Tree> {
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

describe('add-reply-queue schematic', () => {
  it('sets the exchange → reply queue mapping, preserving comments', async () => {
    const tree = await run({ exchange: 'rlb', queue: 'rlb-reply' }, seedConfig());
    expect(String(doc(tree).getIn(['broker', 'replyQueues', 'rlb']))).toBe('rlb-reply');
    expect(read(tree)).toContain('# my config');
  });

  it('is idempotent: re-adding the same mapping leaves a single key', async () => {
    let tree = await run({ exchange: 'rlb', queue: 'rlb-reply' }, seedConfig());
    tree = await run({ exchange: 'rlb', queue: 'rlb-reply' }, tree);
    const replyQueues = doc(tree).getIn(['broker', 'replyQueues']) as any;
    expect(replyQueues.items).toHaveLength(1);
    expect(String(doc(tree).getIn(['broker', 'replyQueues', 'rlb']))).toBe('rlb-reply');
  });

  it('updates the queue for an existing exchange key', async () => {
    let tree = await run({ exchange: 'rlb', queue: 'rlb-reply' }, seedConfig());
    tree = await run({ exchange: 'rlb', queue: 'rlb-reply-2' }, tree);
    const replyQueues = doc(tree).getIn(['broker', 'replyQueues']) as any;
    expect(replyQueues.items).toHaveLength(1);
    expect(String(doc(tree).getIn(['broker', 'replyQueues', 'rlb']))).toBe('rlb-reply-2');
  });

  it('supports multiple exchanges in the map', async () => {
    let tree = await run({ exchange: 'rlb', queue: 'rlb-reply' }, seedConfig());
    tree = await run({ exchange: 'events', queue: 'events-reply' }, tree);
    expect(String(doc(tree).getIn(['broker', 'replyQueues', 'rlb']))).toBe('rlb-reply');
    expect(String(doc(tree).getIn(['broker', 'replyQueues', 'events']))).toBe('events-reply');
  });

  it('creates config.yaml when it does not exist', async () => {
    const tree = await run({ exchange: 'rlb', queue: 'rlb-reply' }, Tree.empty());
    expect(tree.exists('config/config.yaml')).toBe(true);
    expect(String(doc(tree).getIn(['broker', 'replyQueues', 'rlb']))).toBe('rlb-reply');
  });
});
