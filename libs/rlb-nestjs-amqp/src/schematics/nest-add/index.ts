import { apply, branchAndMerge, chain, MergeStrategy, mergeWith, move, noop, Rule, SchematicContext, Tree, url } from '@angular-devkit/schematics';
import { parse } from 'jsonc-parser';
import { normalize } from 'path';
import { normalizeToKebabOrSnakeCase } from '../utils/formatting';
import { Location, NameParser } from '../utils/name.parser';
import { mergeSourceRoot } from '../utils/source-root.helpers';
import { InitOptions } from './init.schema';

type UpdateJsonFn<T> = (obj: T) => T | void;

// ---------------------------------------------------------------------------
// Costanti per BrokerModule — la parte gateway è inclusa solo se `gateway` è on
// ---------------------------------------------------------------------------

function brokerImportLine(gateway: boolean): string {
  // BrokerModule only owns broker/topics/app. When gateway is on, auth-providers and the
  // gateway config are wired into ProxyModule instead (so import those types there).
  const broker = gateway
    ? "import { AppConfig, BrokerModule, BrokerTopic, GatewayConfig, HandlerAuthConfig, ProxyModule, RabbitMQConfig } from '@open-rlb/nestjs-amqp';"
    : "import { AppConfig, BrokerModule, BrokerTopic, RabbitMQConfig } from '@open-rlb/nestjs-amqp';";
  const config = "\nimport { ConfigModule, ConfigService } from '@nestjs/config';";
  const http = gateway ? "\nimport { HttpModule } from '@nestjs/axios';" : '';
  return broker + config + http;
}

function brokerForRootAsync(): string {
  return `BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        options: configService.get<RabbitMQConfig>('broker')!,
        topics: configService.get<BrokerTopic[]>('topics')!,
        appOptions: configService.get<AppConfig>('app'),
      })
    })`;
}

function proxyForRootAsync(): string {
  // Gateway owns auth-providers + gateway config (moved out of BrokerModule). Add ACL/role
  // service bindings in the `providers` array when needed.
  return `ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        authOptions: configService.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: configService.get<GatewayConfig>('gateway'),
      }),
      providers: [],
    })`;
}

// ---------------------------------------------------------------------------
// Costanti per config.yaml — la sezione `gateway` è inclusa solo se gateway è on
// ---------------------------------------------------------------------------

const CONFIG_YAML_BASE = `
app:
  port: 80
  host: 0.0.0.0
  environment: "development"

auth-providers: []

broker:
  name: "rabbitmq"
  uri: "<AMQP_URI>"
  defaultSubscribeErrorBehavior: "ack"
  defaultPublishErrorBehavior: "reject"
  connectionManagerOptions:
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: "<APP_NAME>"
      credentials:
        mechanism: PLAIN
        username: "<AMQP_USERNAME>"
        password: "<AMQP_PASSWORD>"
  exchanges:
    - name: example.fanout
      type: "fanout"
      createExchangeIfNotExists: true
      options:
        durable: true
        autoDelete: false
        internal: false
  queues:
    - name: example.queue
      createQueueIfNotExists: true
      exchange: example.fanout
      routingKey: example.queue
      options:
        durable: true
        autoDelete: false
        exclusive: false

topics:
  - name: example.topic
    exchange: example.fanout
    routingKey: "example.topic"
    mode: event
`;

const CONFIG_YAML_GATEWAY = `
gateway:
  events: []
  ws:
    heartbeatIntervalMs: 30000
    ***REMOVED*** Auth is declared per-event (events[].auth / requireAuth / roles / scopeClaim).
  paths:
    - name: example-path
      method: POST
      dataSource: body
      path: /example
      topic: example.topic
      action: example-action
      mode: event
`;

function configYaml(gateway: boolean): string {
  return gateway ? CONFIG_YAML_BASE.trimEnd() + '\n' + CONFIG_YAML_GATEWAY : CONFIG_YAML_BASE;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function main(options: InitOptions): Rule {
  options = transform(options);
  const gateway = options.gateway !== false; // default on
  const skills = options.skills !== false; // default on
  return (tree: Tree, context: SchematicContext) => {
    return branchAndMerge(
      chain([
        mergeSourceRoot(options),
        addBrokerModuleToAppModule(gateway),
        updateConfigYaml(gateway),
        gateway ? configureMainForGateway() : noop(),
        updatePackageJson(options),
        skills ? copySkills() : noop(),
      ]),
    )(tree, context);
  };
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

function transform(source: InitOptions): InitOptions {
  const target: InitOptions = Object.assign({}, source);
  target.metadata = 'providers';
  target.type = 'module';
  target.language = 'ts';
  const location: Location = new NameParser().parse({ ...target, name: 'init' });
  target.name = '';
  target.path = normalizeToKebabOrSnakeCase(location.path);
  target.specFileSuffix = normalizeToKebabOrSnakeCase(
    source.specFileSuffix || 'spec',
  );
  return target;
}

// ---------------------------------------------------------------------------
// Rule: copia le skill Claude in .claude/skills del progetto consumer
// ---------------------------------------------------------------------------

function copySkills(): Rule {
  // Static asset tree under ./files/skills → moved to .claude/skills (no templating).
  return mergeWith(
    apply(url('./files/skills'), [move(normalize('.claude/skills'))]),
    MergeStrategy.Overwrite,
  );
}

// ---------------------------------------------------------------------------
// Rule: crea o aggiorna config/config.yaml con il blocco di configurazione
// ---------------------------------------------------------------------------

function updateConfigYaml(gateway: boolean): Rule {
  return (tree: Tree) => {
    const CONFIG_PATH = 'config/config.yaml';
    const block = configYaml(gateway);

    if (!tree.exists(CONFIG_PATH)) {
      // Crea il file da zero con l'intero blocco template
      tree.create(CONFIG_PATH, block.trimStart());
      return tree;
    }

    // File esistente: appende solo le sezioni ancora mancanti
    const existing = tree.read(CONFIG_PATH)!.toString('utf-8');
    const SECTION_KEYS = ['app:', 'auth-providers:', 'broker:', 'topics:', ...(gateway ? ['gateway:'] : [])] as const;

    let toAppend = '';
    for (const key of SECTION_KEYS) {
      if (!existing.includes(key)) {
        const section = extractYamlSection(block, key);
        if (section) {
          toAppend += '\n' + section;
        }
      }
    }

    if (toAppend.length > 0) {
      tree.overwrite(CONFIG_PATH, existing.trimEnd() + '\n' + toAppend);
    }

    return tree;
  };
}

/**
 * Estrae dal template YAML il blocco che inizia con `sectionKey`
 * e termina prima del prossimo blocco di primo livello (chiave senza indentazione).
 */
function extractYamlSection(yaml: string, sectionKey: string): string {
  const lines = yaml.split('\n');
  const startIdx = lines.findIndex(l => l.startsWith(sectionKey));
  if (startIdx === -1) return '';

  const endIdx = lines.findIndex(
    (l, i) => i > startIdx && l.length > 0 && !l.startsWith(' ') && !l.startsWith('***REMOVED***'),
  );

  const sectionLines = endIdx === -1 ? lines.slice(startIdx) : lines.slice(startIdx, endIdx);
  return sectionLines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Rule: aggiunge BrokerModule.forRootAsync(...) (+ gateway) ad app.module.ts
// ---------------------------------------------------------------------------

function addBrokerModuleToAppModule(gateway: boolean): Rule {
  return (tree: Tree) => {
    // Cerca app.module.ts nella posizione canonica; fallback su ricerca ricorsiva
    const candidatePaths = [
      '/src/app.module.ts',
      '/app/app.module.ts',
      'src/app.module.ts',
      'app/app.module.ts',
    ];

    let modulePath: string | undefined = candidatePaths.find(p => tree.exists(p));

    if (!modulePath) {
      // Ricerca ricorsiva come ultima risorsa
      modulePath = findFileInTree(tree, 'app.module.ts');
    }

    if (!modulePath) {
      console.warn('[nest-add] app.module.ts non trovato: BrokerModule non aggiunto.');
      return tree;
    }

    const rawContent = tree.read(modulePath);
    if (!rawContent) {
      return tree;
    }

    let content = rawContent.toString('utf-8');

    // ---- 1. Aggiunge l'import statement se non già presente ----------------
    if (!content.includes('@open-rlb/nestjs-amqp')) {
      const importInsertPos = findLastImportEndIndex(content);
      content =
        content.slice(0, importInsertPos) +
        '\n' + brokerImportLine(gateway) +
        content.slice(importInsertPos);
    }

    // ---- 2. Aggiunge le voci nell'array imports (solo il necessario) -------
    // BrokerModule.forRootAsync is the sentinel for "already wired": guard all the
    // entries on it so HttpModule/ProxyModule aren't skipped by their import line.
    if (!content.includes('BrokerModule.forRootAsync')) {
      if (gateway) {
        content = insertIntoImportsArray(content, proxyForRootAsync());
        content = insertIntoImportsArray(content, 'HttpModule');
      }
      content = insertIntoImportsArray(content, brokerForRootAsync());
    }

    tree.overwrite(modulePath, content);
    return tree;
  };
}

// ---------------------------------------------------------------------------
// Rule: abilita rawBody + WsAdapter in main.ts (solo gateway)
// ---------------------------------------------------------------------------

function configureMainForGateway(): Rule {
  return (tree: Tree) => {
    const candidatePaths = ['/src/main.ts', '/app/main.ts', 'src/main.ts', 'app/main.ts'];
    const mainPath = candidatePaths.find(p => tree.exists(p)) || findFileInTree(tree, 'main.ts');
    if (!mainPath) {
      console.warn('[nest-add] main.ts non trovato: abilita manualmente rawBody e WsAdapter.');
      return tree;
    }
    let content = tree.read(mainPath)!.toString('utf-8');
    if (content.includes('WsAdapter')) {
      return tree; // già configurato
    }

    // import WsAdapter dopo l'ultimo import
    const pos = findLastImportEndIndex(content);
    content = content.slice(0, pos) + "\nimport { WsAdapter } from '@nestjs/platform-ws';" + content.slice(pos);

    // abilita rawBody e registra il WS adapter subito dopo NestFactory.create(...)
    const m = content.match(/const\s+(\w+)\s*=\s*await\s+NestFactory\.create\(\s*([A-Za-z0-9_]+)\s*(,\s*\{[^}]*\})?\s*\)\s*;?/);
    if (m) {
      const appVar = m[1];
      const moduleArg = m[2];
      const replacement = `const ${appVar} = await NestFactory.create(${moduleArg}, { rawBody: true });\n  ${appVar}.useWebSocketAdapter(new WsAdapter(${appVar}));`;
      content = content.replace(m[0], replacement);
    } else {
      console.warn('[nest-add] NestFactory.create() non trovato in main.ts: aggiungi { rawBody: true } e useWebSocketAdapter manualmente.');
    }

    tree.overwrite(mainPath, content);
    return tree;
  };
}

/**
 * Inserisce `moduleEntry` all'interno del primo array `imports: [...]`
 * trovato nel decoratore @Module di NestJS.
 *
 * Gestisce sia array su singola riga sia array multi-riga.
 */
function insertIntoImportsArray(source: string, moduleEntry: string): string {
  // Trova "imports:" seguito (eventualmente con spazi/newline) da "["
  const importsArrayRegex = /imports\s*:\s*\[/;
  const match = importsArrayRegex.exec(source);
  if (!match) {
    return source;
  }

  // Posizione del "[" che apre l'array
  const openBracketPos = source.indexOf('[', match.index);

  // Trova il corrispondente "]" tenendo conto di bracket annidati
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

  if (closeBracketPos === -1) {
    return source; // array non chiuso correttamente
  }

  // Determina il contenuto corrente dell'array (senza le parentesi quadre)
  const arrayContent = source.slice(openBracketPos + 1, closeBracketPos).trim();

  let newArrayContent: string;
  if (arrayContent.length === 0) {
    // Array vuoto → inserisce direttamente
    newArrayContent = `\n    ${moduleEntry},\n  `;
  } else {
    // Array con contenuto → aggiunge in testa (prima entry), con virgola finale
    newArrayContent = `\n    ${moduleEntry},\n    ${arrayContent}\n  `;
  }

  return (
    source.slice(0, openBracketPos + 1) +
    newArrayContent +
    source.slice(closeBracketPos)
  );
}

/**
 * Restituisce la posizione di fine dell'ultimo statement `import` nel file,
 * utile per inserire un nuovo import subito dopo l'ultimo esistente.
 */
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
 * Ricerca ricorsiva di un file per nome all'interno dell'albero Schematics.
 */
function findFileInTree(tree: Tree, fileName: string): string | undefined {
  let found: string | undefined;
  tree.visit(path => {
    if (!found && path.endsWith(`/${fileName}`)) {
      found = path;
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Rule: aggiorna package.json (hook per script futuri)
// ---------------------------------------------------------------------------

function updatePackageJson(options: InitOptions) {
  return (host: Tree) => {
    if (!host.exists('package.json')) {
      return host;
    }
    return updateJsonFile(
      host,
      'package.json',
      (packageJson: Record<string, any>) => {
        updateNpmScripts(packageJson.scripts, options);
      },
    );
  };
}

function updateJsonFile<T>(
  host: Tree,
  path: string,
  callback: UpdateJsonFn<T>,
): Tree {
  const source = host.read(path);
  if (source) {
    const sourceText = source.toString('utf-8');
    const json = parse(sourceText);
    callback(json as unknown as T);
    host.overwrite(path, JSON.stringify(json, null, 2));
  }
  return host;
}

function updateNpmScripts(scripts: Record<string, any>, _options: InitOptions) {
  if (!scripts) {
    return;
  }
}
