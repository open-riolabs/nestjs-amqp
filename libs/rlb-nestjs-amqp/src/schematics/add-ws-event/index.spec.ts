import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddWsEventOptions } from './schema';

/**
 * Schematics are tested by invoking the factory Rule directly against a Tree, NOT via
 * SchematicTestRunner (its testing entrypoint eagerly loads `ora`, an ESM-only module jest cannot
 * transform here). Passing `name` makes `flagsProvided` true, so no interactive prompt is attempted.
 */
function makeCtx(warnings: string[] = []): SchematicContext {
  return { logger: { info() {}, warn: (m: string) => warnings.push(m), error() {} } } as unknown as SchematicContext;
}

async function run(options: AddWsEventOptions, tree: Tree, ctx = makeCtx()): Promise<Tree> {
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
  tree.create('config/config.yaml', ['# my config', 'gateway:', '  events: []', ''].join('\n'));
  return tree;
}

describe('add-ws-event schematic', () => {
  it('appends a ws event with exchange/routingKey/scoping, preserving comments', async () => {
    const tree = await run(
      {
        name: 'order-updates',
        type: 'ws',
        exchange: 'rlb',
        routingKey: 'order.updated',
        auth: 'keycloak',
        scopeClaim: 'sub',
        payloadKey: 'userId',
      },
      seedConfig(),
    );
    const events = doc(tree).getIn(['gateway', 'events']) as any;
    expect(events.items.map((i: any) => String(i.get('name')))).toEqual(['order-updates']);
    const ev = events.items[0];
    expect(String(ev.get('type'))).toBe('ws');
    expect(String(ev.get('exchange'))).toBe('rlb');
    expect(String(ev.get('scopeClaim'))).toBe('sub');
    expect(read(tree)).toContain('# my config');
  });

  it('maps httpMethod onto `method` for http events (no ws-only fields leak)', async () => {
    const tree = await run(
      { name: 'webhook', type: 'http', url: 'https://hooks/x', httpMethod: 'POST', timeout: 5000, exchange: 'ignored' },
      seedConfig(),
    );
    const ev = (doc(tree).getIn(['gateway', 'events']) as any).items[0];
    expect(String(ev.get('method'))).toBe('POST');
    expect(String(ev.get('url'))).toBe('https://hooks/x');
    // ws-only field must not appear on an http event.
    expect(ev.get('exchange')).toBeUndefined();
  });

  it('warns when scopeClaim is set without payloadKey (denies every message)', async () => {
    const warnings: string[] = [];
    await run(
      { name: 'leaky', type: 'ws', exchange: 'rlb', routingKey: 'x', auth: 'kc', scopeClaim: 'sub' },
      seedConfig(),
      makeCtx(warnings),
    );
    expect(warnings.some((w) => w.includes('scopeClaim without payloadKey'))).toBe(true);
  });

  it('is idempotent and creates config.yaml when missing', async () => {
    let tree = await run({ name: 'e1', type: 'ws', exchange: 'rlb', routingKey: 'k' }, Tree.empty());
    expect(tree.exists('config/config.yaml')).toBe(true);
    tree = await run({ name: 'e1', type: 'ws', exchange: 'rlb', routingKey: 'k' }, tree);
    const names = (doc(tree).getIn(['gateway', 'events']) as any).items.map((i: any) => String(i.get('name')));
    expect(names.filter((n: string) => n === 'e1')).toHaveLength(1);
  });
});
