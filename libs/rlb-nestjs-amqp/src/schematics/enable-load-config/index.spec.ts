import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { EnableLoadConfigOptions } from './schema';

/**
 * Factory invoked directly against a Tree (not SchematicTestRunner — ESM `ora`). Passing
 * `pathsTopic` makes `flagsProvided` true → no prompts.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: EnableLoadConfigOptions, tree: Tree): Promise<Tree> {
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
  tree.create('config/config.yaml', ['# my config', 'gateway:', '  paths: []', ''].join('\n'));
  return tree;
}

describe('enable-load-config schematic', () => {
  it('sets gateway.loadConfig.paths with defaults, preserving comments', async () => {
    const tree = await run({ pathsTopic: 'rlb-gateway-admin' }, seedConfig());
    const d = doc(tree);
    expect(String(d.getIn(['gateway', 'loadConfig', 'paths', 'topic']))).toBe('rlb-gateway-admin');
    expect(String(d.getIn(['gateway', 'loadConfig', 'paths', 'action']))).toBe('gw-path-export');
    expect(d.hasIn(['gateway', 'loadConfig', 'events'])).toBe(false);
    expect(read(tree)).toContain('# my config');
  });

  it('adds events only when both eventsTopic and eventsAction are provided', async () => {
    const tree = await run(
      { pathsTopic: 'p', pathsAction: 'pa', eventsTopic: 'e', eventsAction: 'ea' },
      seedConfig(),
    );
    const d = doc(tree);
    expect(String(d.getIn(['gateway', 'loadConfig', 'events', 'topic']))).toBe('e');
    expect(String(d.getIn(['gateway', 'loadConfig', 'events', 'action']))).toBe('ea');
  });

  it('skips events when only one of the pair is given', async () => {
    const tree = await run({ pathsTopic: 'p', eventsTopic: 'e' }, seedConfig());
    expect(doc(tree).hasIn(['gateway', 'loadConfig', 'events'])).toBe(false);
  });

  it('is idempotent', async () => {
    let tree = await run({ pathsTopic: 'rlb-gateway-admin' }, seedConfig());
    tree = await run({ pathsTopic: 'rlb-gateway-admin' }, tree);
    const d = doc(tree);
    expect(String(d.getIn(['gateway', 'loadConfig', 'paths', 'topic']))).toBe('rlb-gateway-admin');
  });
});
