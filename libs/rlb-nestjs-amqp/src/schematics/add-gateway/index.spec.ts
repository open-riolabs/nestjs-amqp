import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { configAndWireRule } from './index';
import { AddGatewayOptions } from './schema';

/**
 * Tests target `configAndWireRule` (config.yaml + TS wiring) directly against a Tree. The full `main`
 * additionally copies in-memory-repo assets via url()/mergeWith, which needs a real engine context —
 * that path is covered by the end-to-end CLI run, not this unit test.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: AddGatewayOptions, tree: Tree): Promise<Tree> {
  const rule = configAndWireRule(options) as (t: Tree, c: SchematicContext) => Promise<Tree>;
  return (await rule(tree, ctx)) || tree;
}

function read(tree: Tree, path = 'config/config.yaml'): string {
  return tree.read(path)!.toString('utf-8');
}
const doc = (tree: Tree) => parseDocument(read(tree));
const topicNames = (tree: Tree): string[] =>
  ((doc(tree).getIn(['topics']) as any)?.items || []).map((i: any) => String(i.get('name')));
const queueNames = (tree: Tree): string[] =>
  ((doc(tree).getIn(['broker', 'queues']) as any)?.items || []).map((i: any) => String(i.get('name')));
const pathNames = (tree: Tree): string[] =>
  ((doc(tree).getIn(['gateway', 'paths']) as any)?.items || []).map((i: any) => String(i.get('name')));

function seedMicroservice(): Tree {
  const tree = Tree.empty();
  tree.create(
    'config/config.yaml',
    [
      '# my service',
      'broker:',
      '  routeDiscovery:',
      '    serviceName: "svc"',
      '    exchange: rlb-route-discovery',
      '    queue: rlb-route-sync',
      '  exchanges: []',
      '  queues: []',
      'topics: []',
      '',
    ].join('\n'),
  );
  return tree;
}

const APP_MODULE = `import { Module } from '@nestjs/common';

@Module({ imports: [] })
export class AppModule {}
`;
const MAIN_TS = `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
`;

function seedProject(): Tree {
  const tree = seedMicroservice();
  tree.create('src/app.module.ts', APP_MODULE);
  tree.create('src/main.ts', MAIN_TS);
  tree.create('package.json', JSON.stringify({ name: 'demo', dependencies: {} }, null, 2));
  return tree;
}

describe('add-gateway schematic', () => {
  describe('config.yaml', () => {
    it('removes publisher route-discovery and declares the fixed acl/admin/control topics', async () => {
      const tree = await run({}, seedMicroservice());
      const d = doc(tree);
      expect(d.hasIn(['broker', 'routeDiscovery'])).toBe(false);
      expect(topicNames(tree)).toEqual(expect.arrayContaining(['rlb-acl', 'rlb-gateway-admin', 'rlb-gateway-control']));
      const byName = (n: string) => (d.getIn(['topics']) as any).items.find((i: any) => String(i.get('name')) === n);
      expect(String(byName('rlb-gateway-control').get('mode'))).toBe('broadcast');
      expect(queueNames(tree)).toEqual(expect.arrayContaining(['rlb-acl', 'rlb-gateway-admin', 'rlb-route-sync']));
      expect(String(d.getIn(['gateway', 'reloadTopic']))).toBe('rlb-gateway-control');
      expect(read(tree)).toContain('# my service');
    });

    it('seeds the ACL + admin management routes into gateway.paths', async () => {
      const tree = await run({}, seedMicroservice());
      const names = pathNames(tree);
      expect(names).toEqual(expect.arrayContaining(['acl-check-action', 'acl-grant', 'gw-path-list', 'gw-reload', 'health']));
    });

    it('does not clobber a pre-existing gateway section', async () => {
      const tree = seedMicroservice();
      tree.overwrite(
        'config/config.yaml',
        read(tree) + ['gateway:', '  ws:', '    heartbeatIntervalMs: 9999', '  reloadTopic: my-custom-topic', ''].join('\n'),
      );
      const d = doc(await run({}, tree));
      expect(String(d.getIn(['gateway', 'ws', 'heartbeatIntervalMs']))).toBe('9999');
      expect(String(d.getIn(['gateway', 'reloadTopic']))).toBe('my-custom-topic');
    });

    it('is idempotent: re-running duplicates neither topics nor management routes', async () => {
      let tree = await run({}, seedMicroservice());
      tree = await run({}, tree);
      expect(topicNames(tree).filter((n) => n === 'rlb-acl')).toHaveLength(1);
      expect(pathNames(tree).filter((n) => n === 'acl-check-action')).toHaveLength(1);
    });

    it('respects feature toggles (acl/routeReception off)', async () => {
      const tree = await run({ acl: false, routeReception: false }, seedMicroservice());
      expect(topicNames(tree)).not.toContain('rlb-acl');
      expect(pathNames(tree)).not.toContain('acl-check-action');
      expect(topicNames(tree)).toContain('rlb-gateway-admin');
    });
  });

  describe('TypeScript wiring', () => {
    it('wires the modules into AppModule and merges the lib import', async () => {
      const tree = await run({}, seedProject());
      const mod = tree.read('src/app.module.ts')!.toString('utf-8');
      expect(mod).toContain('BrokerModule.forRootAsync');
      expect(mod).toContain('ProxyModule.forRootAsync');
      expect(mod).toContain('AclModule.forRoot');
      expect(mod).toContain('GatewayAdminModule.forRoot');
      expect(mod).toContain('HttpModule');
      expect(mod).toContain(`from '@open-rlb/nestjs-amqp'`);
      expect(mod).toContain(`from '@nestjs/config'`);
      expect(tree.exists('src/config/config.loader.ts')).toBe(true);
    });

    it('patches main.ts (rawBody + WsAdapter) and package.json deps', async () => {
      const tree = await run({}, seedProject());
      const main = tree.read('src/main.ts')!.toString('utf-8');
      expect(main).toContain('rawBody: true');
      expect(main).toContain('useWebSocketAdapter(new WsAdapter');
      const pkg = JSON.parse(tree.read('package.json')!.toString('utf-8'));
      expect(pkg.dependencies['@nestjs/axios']).toBeDefined();
      expect(pkg.dependencies['@nestjs/platform-ws']).toBeDefined();
    });

    it('is idempotent: re-running does not duplicate the module entries', async () => {
      let tree = await run({}, seedProject());
      tree = await run({}, tree);
      const mod = tree.read('src/app.module.ts')!.toString('utf-8');
      expect(mod.match(/ProxyModule\.forRootAsync/g)).toHaveLength(1);
      expect(mod.match(/BrokerModule\.forRootAsync/g)).toHaveLength(1);
      expect(mod.match(/AclModule\.forRoot/g)).toHaveLength(1);
    });

    it('merges into an existing lib import without duplicating it', async () => {
      const tree = seedProject();
      tree.overwrite(
        'src/app.module.ts',
        `import { Module } from '@nestjs/common';\nimport { BrokerModule } from '@open-rlb/nestjs-amqp';\n\n@Module({ imports: [] })\nexport class AppModule {}\n`,
      );
      const mod = (await run({}, tree)).read('src/app.module.ts')!.toString('utf-8');
      expect(mod.match(/from '@open-rlb\/nestjs-amqp'/g)).toHaveLength(1);
      expect(mod).toContain('ProxyModule');
      expect(mod).toContain('AclModule');
    });
  });
});
