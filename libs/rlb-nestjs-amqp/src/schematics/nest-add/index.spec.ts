import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { parseDocument } from 'yaml';
import { main } from './index';
import { InitOptions } from './init.schema';

/**
 * nest-add's core work (base config.yaml + config loader + ConfigModule/BrokerModule wiring + deps)
 * runs before it returns the skills Rule. We invoke the factory directly with `skills: false` so the
 * returned Rule is a noop (no url()/engine needed) and assert the tree the core steps produced.
 */
const ctx = { logger: { info() {}, warn() {}, error() {} } } as unknown as SchematicContext;

async function run(options: InitOptions, tree: Tree): Promise<Tree> {
  const rule = main(options) as (t: Tree, c: SchematicContext) => Promise<Rule>;
  await rule(tree, ctx); // executes the core steps; returned Rule (skills) is ignored
  return tree;
}

function seedProject(withConfig = false): Tree {
  const tree = Tree.empty();
  tree.create('src/app.module.ts', `import { Module } from '@nestjs/common';\n\n@Module({ imports: [] })\nexport class AppModule {}\n`);
  tree.create('package.json', JSON.stringify({ name: 'demo', dependencies: {} }, null, 2));
  if (withConfig) tree.create('config/config.yaml', '# existing\napp:\n  port: 3000\n');
  return tree;
}

describe('nest-add schematic (core bootstrap)', () => {
  it('creates a base config.yaml with app/broker/topics', async () => {
    const tree = await run({ skills: false }, seedProject());
    expect(tree.exists('config/config.yaml')).toBe(true);
    const d = parseDocument(tree.read('config/config.yaml')!.toString('utf-8'));
    expect(d.hasIn(['app'])).toBe(true);
    expect(d.hasIn(['broker'])).toBe(true);
    expect(d.hasIn(['topics'])).toBe(true);
  });

  it('wires ConfigModule + BrokerModule (core) into AppModule and creates the loader', async () => {
    const tree = await run({ skills: false }, seedProject());
    const mod = tree.read('src/app.module.ts')!.toString('utf-8');
    expect(mod).toContain('ConfigModule.forRoot');
    expect(mod).toContain('BrokerModule.forRootAsync');
    expect(mod).toContain(`from '@open-rlb/nestjs-amqp'`);
    // Core only — no gateway modules.
    expect(mod).not.toContain('ProxyModule');
    expect(mod).not.toContain('GatewayAdminModule');
    expect(tree.exists('src/config/config.loader.ts')).toBe(true);
  });

  it('adds core deps to package.json', async () => {
    const tree = await run({ skills: false }, seedProject());
    const pkg = JSON.parse(tree.read('package.json')!.toString('utf-8'));
    expect(pkg.dependencies['@nestjs/config']).toBeDefined();
    expect(pkg.dependencies['js-yaml']).toBeDefined();
  });

  it('does not clobber an existing config.yaml, only backfills missing sections', async () => {
    const tree = await run({ skills: false }, seedProject(true));
    const raw = tree.read('config/config.yaml')!.toString('utf-8');
    expect(raw).toContain('# existing');
    const d = parseDocument(raw);
    expect(String(d.getIn(['app', 'port']))).toBe('3000'); // preserved
    expect(d.hasIn(['broker'])).toBe(true); // backfilled
    expect(d.hasIn(['topics'])).toBe(true); // backfilled
  });

  it('is idempotent: re-running does not duplicate the core module entries', async () => {
    let tree = await run({ skills: false }, seedProject());
    tree = await run({ skills: false }, tree);
    const mod = tree.read('src/app.module.ts')!.toString('utf-8');
    expect(mod.match(/BrokerModule\.forRootAsync/g)).toHaveLength(1);
    expect(mod.match(/ConfigModule\.forRoot/g)).toHaveLength(1);
  });
});
