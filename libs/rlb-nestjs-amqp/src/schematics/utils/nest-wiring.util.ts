import { Tree } from '@angular-devkit/schematics';

/**
 * TypeScript-source wiring helpers shared by the scaffolding schematics (add-gateway today). They
 * edit app.module.ts / main.ts / package.json / the config loader idempotently via light source
 * surgery — the same technique nest-add used, extracted here so a promote-to-gateway run produces a
 * fully wired app, not just YAML. Every helper is a no-op when its target is already in place.
 */

const APP_MODULE_CANDIDATES = ['/src/app.module.ts', '/app/app.module.ts', 'src/app.module.ts', 'app/app.module.ts'];
const MAIN_CANDIDATES = ['/src/main.ts', '/app/main.ts', 'src/main.ts', 'app/main.ts'];

export function findFileInTree(tree: Tree, fileName: string): string | undefined {
  let found: string | undefined;
  tree.visit((path) => {
    if (!found && path.endsWith(`/${fileName}`)) found = path;
  });
  return found;
}

export function findAppModule(tree: Tree): string | undefined {
  return APP_MODULE_CANDIDATES.find((p) => tree.exists(p)) || findFileInTree(tree, 'app.module.ts');
}

export function findMainTs(tree: Tree): string | undefined {
  return MAIN_CANDIDATES.find((p) => tree.exists(p)) || findFileInTree(tree, 'main.ts');
}

function findLastImportEndIndex(source: string): number {
  const importRegex = /^import\s+.+from\s+['"][^'"]+['"];?\s*$/gm;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  return lastEnd;
}

/**
 * Ensure `symbols` are all imported from `@open-rlb/nestjs-amqp`: merge the missing ones into an
 * existing lib import (kept sorted), or insert a fresh import after the last import when none exists.
 */
export function ensureLibImport(source: string, symbols: string[]): string {
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]@open-rlb\/nestjs-amqp['"];?/;
  const m = re.exec(source);
  if (m) {
    const current = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = [...new Set([...current, ...symbols])].sort();
    return source.slice(0, m.index) + `import { ${merged.join(', ')} } from '@open-rlb/nestjs-amqp';` + source.slice(m.index + m[0].length);
  }
  const pos = findLastImportEndIndex(source);
  const line = `\nimport { ${[...new Set(symbols)].sort().join(', ')} } from '@open-rlb/nestjs-amqp';`;
  return source.slice(0, pos) + line + source.slice(pos);
}

/** Ensure a standalone import line is present, keyed by a substring `marker` already-present check. */
export function ensureImportLine(source: string, line: string, marker: string): string {
  if (source.includes(marker)) return source;
  const pos = findLastImportEndIndex(source);
  return source.slice(0, pos) + '\n' + line + source.slice(pos);
}

/** Insert `moduleEntry` at the head of the first `imports: [...]` array of the @Module decorator. */
export function insertIntoImportsArray(source: string, moduleEntry: string): string {
  const match = /imports\s*:\s*\[/.exec(source);
  if (!match) return source;
  const openBracketPos = source.indexOf('[', match.index);

  let depth = 0;
  let closeBracketPos = -1;
  for (let i = openBracketPos; i < source.length; i++) {
    if (source[i] === '[') depth++;
    else if (source[i] === ']') {
      depth--;
      if (depth === 0) {
        closeBracketPos = i;
        break;
      }
    }
  }
  if (closeBracketPos === -1) return source;

  const arrayContent = source.slice(openBracketPos + 1, closeBracketPos).trim();
  const newArrayContent =
    arrayContent.length === 0 ? `\n    ${moduleEntry},\n  ` : `\n    ${moduleEntry},\n    ${arrayContent}\n  `;
  return source.slice(0, openBracketPos + 1) + newArrayContent + source.slice(closeBracketPos);
}

export interface WireEntry {
  /** The literal module entry, e.g. `HttpModule` or `ProxyModule.forRootAsync({...})`. */
  code: string;
  /** Skip this entry when `source` already contains this substring (idempotency sentinel). */
  sentinel: string;
}

export interface WireAppModuleOptions {
  /** Symbols to import from `@open-rlb/nestjs-amqp`. */
  libSymbols: string[];
  /** Extra standalone import lines, each with a presence marker. */
  importLines?: { line: string; marker: string }[];
  /** @Module imports[] entries to add (each only if its sentinel is absent). */
  entries: WireEntry[];
}

/**
 * Wire modules into the app's AppModule: ensure the lib + helper imports, then insert each module
 * entry whose sentinel is missing. Entries are inserted in reverse so the final visual order matches
 * the given array. Returns the module path when found, else undefined (caller logs the skip).
 */
export function wireAppModule(tree: Tree, opts: WireAppModuleOptions): string | undefined {
  const modulePath = findAppModule(tree);
  if (!modulePath) return undefined;
  let content = tree.read(modulePath)!.toString('utf-8');

  content = ensureLibImport(content, opts.libSymbols);
  for (const imp of opts.importLines || []) content = ensureImportLine(content, imp.line, imp.marker);

  const toAdd = opts.entries.filter((e) => !content.includes(e.sentinel));
  for (let i = toAdd.length - 1; i >= 0; i--) content = insertIntoImportsArray(content, toAdd[i].code);

  tree.overwrite(modulePath, content);
  return modulePath;
}

// --- Core (BrokerModule) wiring shared by nest-add and add-gateway --------------------------------

/** Lib symbols every core (microservice) AppModule needs. */
export function coreLibSymbols(): string[] {
  return ['AppConfig', 'BrokerModule', 'BrokerTopic', 'RabbitMQConfig'];
}

/** The ConfigModule + config-loader import lines. */
export function coreImportLines(): { line: string; marker: string }[] {
  return [
    { line: `import { ConfigModule, ConfigService } from '@nestjs/config';`, marker: '@nestjs/config' },
    { line: `import yamlConfig from './config/config.loader';`, marker: './config/config.loader' },
  ];
}

/** `ConfigModule.forRoot({...})` entry (sentinel: 'ConfigModule.forRoot'). */
export function configModuleEntry(): WireEntry {
  return { code: `ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] })`, sentinel: 'ConfigModule.forRoot' };
}

/** `BrokerModule.forRootAsync({...})` entry (sentinel: 'BrokerModule.forRootAsync'). */
export function brokerModuleEntry(): WireEntry {
  return {
    code: `BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        options: configService.get<RabbitMQConfig>('broker')!,
        topics: configService.get<BrokerTopic[]>('topics')!,
        appOptions: configService.get<AppConfig>('app'),
      })
    })`,
    sentinel: 'BrokerModule.forRootAsync',
  };
}

/** Create src/config/config.loader.ts (js-yaml loader) when missing. */
export function createConfigLoader(tree: Tree): void {
  const path = 'src/config/config.loader.ts';
  if (tree.exists(path)) return;
  tree.create(
    path,
    `import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const YAML_CONFIG_FILENAME = 'config/config.yaml';

export default () =>
  yaml.load(readFileSync(join(process.cwd(), YAML_CONFIG_FILENAME), 'utf8')) as Record<string, any>;
`,
  );
}

/** Enable rawBody + the WebSocket adapter + shutdown hooks in main.ts (idempotent). Returns false if unwired. */
export function configureMainForGateway(tree: Tree): boolean {
  const mainPath = findMainTs(tree);
  if (!mainPath) return false;
  let content = tree.read(mainPath)!.toString('utf-8');
  if (content.includes('WsAdapter')) return true;

  content = ensureImportLine(content, `import { WsAdapter } from '@nestjs/platform-ws';`, '@nestjs/platform-ws');

  const m = content.match(/const\s+(\w+)\s*=\s*await\s+NestFactory\.create[^(]*\(\s*([A-Za-z0-9_]+)\s*(,\s*\{[^}]*\})?\s*\)\s*;?/);
  if (m) {
    const appVar = m[1];
    const moduleArg = m[2];
    const replacement = `const ${appVar} = await NestFactory.create(${moduleArg}, { rawBody: true });\n  ${appVar}.useWebSocketAdapter(new WsAdapter(${appVar}));\n  ${appVar}.enableShutdownHooks();`;
    content = content.replace(m[0], replacement);
  }
  tree.overwrite(mainPath, content);
  return true;
}

/** Add runtime dependencies to package.json (only when absent). No-op without a package.json. */
export function addDeps(tree: Tree, deps: Record<string, string>): void {
  if (!tree.exists('package.json')) return;
  const pkg = JSON.parse(tree.read('package.json')!.toString('utf-8'));
  pkg.dependencies = pkg.dependencies || {};
  for (const [name, version] of Object.entries(deps)) {
    if (!pkg.dependencies[name]) pkg.dependencies[name] = version;
  }
  tree.overwrite('package.json', JSON.stringify(pkg, null, 2));
}
