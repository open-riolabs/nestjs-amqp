import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { EnableRouteDiscoveryOptions } from './schema';

/** Invoke the factory Rule directly (SchematicTestRunner eagerly loads ESM `ora`). */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: EnableRouteDiscoveryOptions, tree: Tree): Promise<Tree> {
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
  tree.create('config/config.yaml', ['# my config', 'broker:', '  exchanges: []', 'topics: []', ''].join('\n'));
  return tree;
}

describe('enable-route-discovery schematic', () => {
  it('sets broker.routeDiscovery and kebab-normalizes the service name', async () => {
    const tree = await run({ serviceName: 'OrderService' }, seedConfig());
    const rd = doc(tree).getIn(['broker', 'routeDiscovery']) as any;
    expect(String(rd.get('serviceName'))).toBe('order-service');
    expect(String(rd.get('exchange'))).toBe('rlb-route-discovery');
    expect(String(rd.get('queue'))).toBe('rlb-route-sync');
    expect(rd.get('publishOnBoot')).toBe(true);
    expect(read(tree)).toContain('# my config');
  });

  it('declares the discovery exchange as fanout', async () => {
    const tree = await run({ serviceName: 'billing' }, seedConfig());
    const exchanges = doc(tree).getIn(['broker', 'exchanges']) as any;
    const ex = exchanges.items.find((i: any) => String(i.get('name')) === 'rlb-route-discovery');
    expect(ex).toBeDefined();
    expect(String(ex.get('type'))).toBe('fanout');
  });

  it('is idempotent: re-running with the same values does not duplicate the exchange', async () => {
    let tree = await run({ serviceName: 'billing' }, seedConfig());
    const first = read(tree);
    tree = await run({ serviceName: 'billing' }, tree);
    expect(read(tree)).toBe(first);
    const exchanges = doc(tree).getIn(['broker', 'exchanges']) as any;
    const count = exchanges.items.filter((i: any) => String(i.get('name')) === 'rlb-route-discovery').length;
    expect(count).toBe(1);
  });
});
