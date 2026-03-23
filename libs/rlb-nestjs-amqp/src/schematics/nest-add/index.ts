import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, branchAndMerge, chain, FileEntry, forEach, MergeStrategy, mergeWith, move, Rule, SchematicContext, Tree, url } from '@angular-devkit/schematics';
import { parse } from 'jsonc-parser';
import { normalize } from 'path';
import { normalizeToKebabOrSnakeCase } from '../utils/formatting';
import { Location, NameParser } from '../utils/name.parser';
import { mergeSourceRoot } from '../utils/source-root.helpers';
import { InitOptions } from './init.schema';

type UpdateJsonFn<T> = (obj: T) => T | void;

// ---------------------------------------------------------------------------
// Costanti per BrokerModule
// ---------------------------------------------------------------------------

const BROKER_IMPORT_LINE =
  "import { AppConfig, BrokerModule, BrokerTopic, GatewayConfig, HandlerAuthConfig, ProxyModule, RabbitMQConfig } from '@open-rlb/nestjs-amqp';" +
  "\nimport { ConfigModule, ConfigService } from '@nestjs/config';";

const BROKER_FOR_ROOT_ASYNC = `BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        options: configService.get<RabbitMQConfig>('broker')!,
        topics: configService.get<BrokerTopic[]>('topics')!,
        appOptions: configService.get<AppConfig>('app'),
        gatewayOptions: configService.get<GatewayConfig>('gateway'),
        authOptions: configService.get<HandlerAuthConfig[]>('auth-providers'),
      })
    })`;

// ---------------------------------------------------------------------------
// Costanti per config.yaml
// ---------------------------------------------------------------------------

/**
 * Blocco YAML da appendere (o da usare per creare) config/config.yaml.
 * Contiene un solo esempio per ciascuna delle categorie previste.
 */
const CONFIG_YAML_BLOCK = `
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

gateway:
  events: []
  paths:
    - name: example-path
      method: POST
      dataSource: body
      path: /example
      topic: example.topic
      action: example-action
      mode: event
`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function main(options: InitOptions): Rule {
  options = transform(options);
  return (tree: Tree, context: SchematicContext) => {
    return branchAndMerge(
      chain([
        mergeSourceRoot(options),
        addBrokerModuleToAppModule(),
        updateConfigYaml(),
        updatePackageJson(options),
        mergeWith(generate(options), MergeStrategy.Overwrite),
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

function generate(options: InitOptions) {
  return (context: SchematicContext) =>
    apply(url('./files'), [
      applyTemplates({
        classify: strings.classify,
        dasherize: strings.dasherize,
        name: options.name,
      }),
      renameDotfiles,
      move(normalize('./')),
    ])(context);
}

const renameDotfiles = forEach((entry: FileEntry) => {
  if (entry.path.includes('/__dot')) {
    const newPath = normalize(entry.path.replace('/__dot', '/.'));
    return {
      content: entry.content,
      path: newPath,
    } as FileEntry;
  }
  return entry;
});

// ---------------------------------------------------------------------------
// Rule: crea o aggiorna config/config.yaml con il blocco di configurazione
// ---------------------------------------------------------------------------

function updateConfigYaml(): Rule {
  return (tree: Tree) => {
    const CONFIG_PATH = 'config/config.yaml';

    if (!tree.exists(CONFIG_PATH)) {
      // Crea il file da zero con l'intero blocco template
      tree.create(CONFIG_PATH, CONFIG_YAML_BLOCK.trimStart());
      return tree;
    }

    // File esistente: appende solo le sezioni ancora mancanti
    const existing = tree.read(CONFIG_PATH)!.toString('utf-8');
    const SECTION_KEYS = ['app:', 'auth-providers:', 'broker:', 'topics:', 'gateway:'] as const;

    let toAppend = '';
    for (const key of SECTION_KEYS) {
      if (!existing.includes(key)) {
        const block = extractYamlSection(CONFIG_YAML_BLOCK, key);
        if (block) {
          toAppend += '\n' + block;
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
// Rule: aggiunge BrokerModule.forRootAsync(...) ad app.module.ts
// ---------------------------------------------------------------------------

function addBrokerModuleToAppModule(): Rule {
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
      console.warn('[ng-add] app.module.ts non trovato: BrokerModule non aggiunto.');
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
        '\n' + BROKER_IMPORT_LINE +
        content.slice(importInsertPos);
    }

    // ---- 2. Aggiunge BrokerModule.forRootAsync nell'array imports ----------
    if (!content.includes('BrokerModule.forRootAsync')) {
      content = insertIntoImportsArray(content, BROKER_FOR_ROOT_ASYNC);
    }

    tree.overwrite(modulePath, content);
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
// Rule: aggiorna package.json con script jest
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

// ---------------------------------------------------------------------------
// Utility: trova l'indice dell'ultimo import nel formato array di stringhe
// ---------------------------------------------------------------------------

function findImportsEndpoint(contentLines: string[]): number {
  const reversedContent = Array.from(contentLines).reverse();
  const reverseImports = reversedContent.filter(line =>
    line.match(/\} from ('|")/),
  );
  if (reverseImports.length <= 0) {
    return 0;
  }
  return contentLines.indexOf(reverseImports[0]);
}