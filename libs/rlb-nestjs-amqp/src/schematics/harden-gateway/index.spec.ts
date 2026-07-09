import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { HardenGatewayOptions } from './schema';

/** Factory invoked directly against a Tree (not SchematicTestRunner — ESM `ora`). */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: HardenGatewayOptions, tree: Tree): Promise<Tree> {
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
const MAIN_TS = [
  "import { NestFactory } from '@nestjs/core';",
  "import { AppModule } from './app.module';",
  '',
  'async function bootstrap() {',
  '  const app = await NestFactory.create(AppModule, { rawBody: true });',
  '  await app.listen(3000);',
  '}',
  'bootstrap();',
  '',
].join('\n');

describe('harden-gateway schematic', () => {
  it('sets only the provided limits at the right paths', async () => {
    const tree = await run(
      {
        maxConcurrentRequests: 100,
        maxBodyBytes: '5mb',
        uploadMaxFileSizeMb: 10,
        uploadMaxFiles: 3,
        wsMaxBufferedBytes: 1048576,
        wsMaxMessageBytes: 65536,
        allowedOrigins: ['https://a.example', 'https://b.example'],
        patchMain: false,
      },
      seedConfig(),
    );
    const d = doc(tree);
    expect(Number(d.getIn(['gateway', 'maxConcurrentRequests']))).toBe(100);
    expect(String(d.getIn(['gateway', 'maxBodyBytes']))).toBe('5mb');
    expect(Number(d.getIn(['gateway', 'upload', 'maxFileSizeMb']))).toBe(10);
    expect(Number(d.getIn(['gateway', 'upload', 'maxFiles']))).toBe(3);
    expect(Number(d.getIn(['gateway', 'ws', 'maxBufferedBytes']))).toBe(1048576);
    expect(Number(d.getIn(['gateway', 'ws', 'maxMessageBytes']))).toBe(65536);
    const origins = (d.getIn(['gateway', 'ws', 'allowedOrigins']) as any).items.map((i: any) => String(i));
    expect(origins).toEqual(['https://a.example', 'https://b.example']);
    expect(read(tree)).toContain('# my config');
  });

  it('leaves unrelated keys absent when their option is not passed', async () => {
    const tree = await run({ maxConcurrentRequests: 50, patchMain: false }, seedConfig());
    const d = doc(tree);
    expect(d.hasIn(['gateway', 'maxBodyBytes'])).toBe(false);
    expect(d.hasIn(['gateway', 'upload'])).toBe(false);
    expect(d.hasIn(['gateway', 'ws'])).toBe(false);
  });

  it('patches main.ts once and is idempotent on re-run', async () => {
    const tree = seedConfig();
    tree.create('src/main.ts', MAIN_TS);

    await run({ maxBodyBytes: '5mb' }, tree);
    let mainContent = tree.read('src/main.ts')!.toString('utf-8');
    expect((mainContent.match(/useBodyParser\('json'/g) || []).length).toBe(1);
    expect(mainContent).toContain("import { ConfigService } from '@nestjs/config';");
    expect(mainContent).toContain("import { GatewayConfig } from '@open-rlb/nestjs-amqp';");
    expect(mainContent).toContain("const gateway = app.get(ConfigService).get<GatewayConfig>('gateway');");
    // The injected block follows the create statement.
    expect(mainContent.indexOf('NestFactory.create')).toBeLessThan(mainContent.indexOf('useBodyParser'));

    // Re-run: no duplication.
    await run({ maxBodyBytes: '5mb' }, tree);
    mainContent = tree.read('src/main.ts')!.toString('utf-8');
    expect((mainContent.match(/useBodyParser\('json'/g) || []).length).toBe(1);
  });

  it('does not touch main.ts when patchMain is false', async () => {
    const tree = seedConfig();
    tree.create('src/main.ts', MAIN_TS);
    await run({ maxBodyBytes: '5mb', patchMain: false }, tree);
    expect(tree.read('src/main.ts')!.toString('utf-8')).not.toContain('useBodyParser');
  });

  it('does not patch main.ts when maxBodyBytes is not provided', async () => {
    const tree = seedConfig();
    tree.create('src/main.ts', MAIN_TS);
    await run({ maxConcurrentRequests: 10 }, tree);
    expect(tree.read('src/main.ts')!.toString('utf-8')).not.toContain('useBodyParser');
  });
});
