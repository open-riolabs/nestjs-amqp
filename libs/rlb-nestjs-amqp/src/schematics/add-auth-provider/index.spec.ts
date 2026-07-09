import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { AddAuthProviderOptions } from './schema';

/**
 * Schematics are tested by invoking the factory Rule directly against a Tree, NOT via
 * SchematicTestRunner (its testing entrypoint eagerly loads `ora`, an ESM-only module jest cannot
 * transform here). Passing `name` makes `flagsProvided` true, so no interactive prompt is attempted.
 */
function makeCtx(warnings: string[] = []): SchematicContext {
  return { logger: { info() {}, warn: (m: string) => warnings.push(m), error() {} } } as unknown as SchematicContext;
}

async function run(options: AddAuthProviderOptions, tree: Tree, ctx = makeCtx()): Promise<Tree> {
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
    ['# my config', 'auth-providers:', '  - name: existing', '    type: basic', 'gateway: {}', ''].join('\n'),
  );
  return tree;
}

describe('add-auth-provider schematic', () => {
  it('appends a jwks provider with only type-relevant fields, preserving comments', async () => {
    const tree = await run(
      {
        name: 'keycloak',
        type: 'jwks',
        jwksUri: 'https://kc/realms/x/protocol/openid-connect/certs',
        algorithms: ['RS256'],
        jwtMap: ['sub:userId'],
        uidClaim: 'sub',
        clientSecret: 'should-not-appear',
      },
      seedConfig(),
    );
    const providers = doc(tree).getIn(['auth-providers']) as any;
    expect(providers.items.map((i: any) => String(i.get('name')))).toEqual(['existing', 'keycloak']);
    const kc = providers.items[1];
    expect(String(kc.get('type'))).toBe('jwks');
    expect(String(kc.get('headerPrefix'))).toBe('X-GTW-AUTH-');
    expect(kc.get('jwksUri')).toBeDefined();
    // clientSecret is irrelevant for jwks and must be filtered out.
    expect(kc.get('clientSecret')).toBeUndefined();
    expect(read(tree)).toContain('# my config');
  });

  it('is idempotent: re-adding the same provider leaves a single entry', async () => {
    let tree = await run({ name: 'demo', type: 'basic', clientSecret: 'secret' }, seedConfig());
    tree = await run({ name: 'demo', type: 'basic', clientSecret: 'secret' }, tree);
    const providers = doc(tree).getIn(['auth-providers']) as any;
    const names = providers.items.map((i: any) => String(i.get('name')));
    expect(names.filter((n: string) => n === 'demo')).toHaveLength(1);
  });

  it('warns when a jwt/jwks provider is missing algorithms and jwtMap (fails-closed invariant)', async () => {
    const warnings: string[] = [];
    await run({ name: 'insecure', type: 'jwt', issuer: 'https://issuer' }, seedConfig(), makeCtx(warnings));
    expect(warnings.some((w) => w.includes('algorithms is REQUIRED'))).toBe(true);
    expect(warnings.some((w) => w.includes('without jwtMap'))).toBe(true);
  });

  it('creates config.yaml when it does not exist', async () => {
    const tree = await run({ name: 'demo', type: 'basic', clientSecret: 'secret', uidClaim: 'USERID' }, Tree.empty());
    expect(tree.exists('config/config.yaml')).toBe(true);
    const providers = doc(tree).getIn(['auth-providers']) as any;
    expect(String(providers.items[0].get('name'))).toBe('demo');
    expect(String(providers.items[0].get('uidClaim'))).toBe('USERID');
  });
});
