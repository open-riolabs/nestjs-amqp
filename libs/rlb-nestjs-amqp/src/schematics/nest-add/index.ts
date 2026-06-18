import { apply, branchAndMerge, chain, MergeStrategy, mergeWith, move, noop, Rule, SchematicContext, Tree, url } from '@angular-devkit/schematics';
import { parse } from 'jsonc-parser';
import { normalize } from 'path';
import { normalizeToKebabOrSnakeCase } from '../utils/formatting';
import { Location, NameParser } from '../utils/name.parser';
import { mergeSourceRoot } from '../utils/source-root.helpers';
import { InitOptions } from './init.schema';

type UpdateJsonFn<T> = (obj: T) => T | void;

// ---------------------------------------------------------------------------
// Resolved selections (from interactive prompts or flags/defaults)
// ---------------------------------------------------------------------------

interface Names {
  exchange: string;       // main AMQP exchange backing acl/admin queues (default rlb)
  aclQueue: string;       // queue backing the fixed rlb-acl topic
  adminQueue: string;     // queue backing the fixed rlb-gateway-admin topic
  controlTopic: string;   // broadcast control/reload topic
  routeExchange: string;  // route-discovery fanout exchange
  routeQueue: string;     // route-sync durable queue
  serviceName: string;    // route-publish ownership + connection_name
}

interface Resolved {
  gatewayConfig: boolean; // create the HTTP/WebSocket gateway config
  acl: boolean;           // AclModule + ACL paths
  admin: boolean;         // GatewayAdminModule + DB routes/auth/metrics paths
  routeReception: boolean;// gateway consumes routes auto-published by microservices
  autoPublish: boolean;   // microservice publishes its @BrokerHTTP routes on boot
  skills: boolean;        // copy the Claude skills
  names: Names;
}

function defaultNames(project: string): Names {
  return {
    exchange: 'rlb',
    aclQueue: 'rlb-acl',
    adminQueue: 'rlb-gateway-admin',
    controlTopic: 'rlb-gateway-control',
    routeExchange: 'rlb-route-discovery',
    routeQueue: 'rlb-route-sync',
    serviceName: project || 'my-service',
  };
}

/**
 * Resolves the install selections. When stdin is a TTY and no flags were passed, it drives a
 * branching interactive flow with @inquirer/prompts:
 *   - "Create a gateway configuration?" → yes: pick {acl, gateway-admin, route-reception} and the
 *     topic/queue/exchange names (rlb-* defaults); no: pick {auto-config-publish} (+ names).
 * Otherwise it falls back to the provided flags + rlb-* defaults (non-interactive / CI).
 */
async function resolveSelections(o: InitOptions, context: SchematicContext): Promise<Resolved> {
  const project = (o.project || 'my-service').toString();
  const d = defaultNames(project);
  const flagsProvided = o.gatewayConfig !== undefined || (Array.isArray(o.features) && o.features.length > 0);
  const canPrompt = !!process.stdout && !!process.stdout.isTTY && !process.env.CI && !flagsProvided;

  let prompts: any;
  if (canPrompt) {
    try {
      prompts = require('@inquirer/prompts');
    } catch {
      context.logger.warn('[nest-add] @inquirer/prompts not found; falling back to flags/defaults (non-interactive).');
      prompts = undefined;
    }
  }

  // ---- Non-interactive: derive everything from flags + defaults --------------
  if (!prompts) {
    const features = new Set((o.features || []).map((f) => String(f).trim()));
    const gatewayConfig = o.gatewayConfig === true;
    return {
      gatewayConfig,
      acl: gatewayConfig && features.has('acl'),
      admin: gatewayConfig && features.has('gateway-admin'),
      routeReception: gatewayConfig && features.has('route-reception'),
      autoPublish: !gatewayConfig && features.has('auto-config-publish'),
      skills: o.skills !== false,
      names: {
        exchange: o.exchange || d.exchange,
        aclQueue: o.aclQueue || d.aclQueue,
        adminQueue: o.adminQueue || d.adminQueue,
        controlTopic: o.controlTopic || d.controlTopic,
        routeExchange: o.routeExchange || d.routeExchange,
        routeQueue: o.routeQueue || d.routeQueue,
        serviceName: o.serviceName || d.serviceName,
      },
    };
  }

  // ---- Interactive branching flow -------------------------------------------
  const { confirm, checkbox, input } = prompts;
  const names: Names = { ...d };
  let acl = false, admin = false, routeReception = false, autoPublish = false;

  const gatewayConfig: boolean = await confirm({
    message: 'Create a gateway (HTTP/WebSocket) configuration?',
    default: false,
  });

  if (gatewayConfig) {
    const picked: string[] = await checkbox({
      message: 'Select gateway features to include',
      choices: [
        { name: 'ACL — role-based authorization + management', value: 'acl' },
        { name: 'Gateway admin + auth — DB-managed routes, auth-providers, metrics', value: 'gateway-admin' },
        { name: 'Route reception — apply routes auto-published by microservices', value: 'route-reception' },
      ],
    });
    acl = picked.includes('acl');
    admin = picked.includes('gateway-admin');
    routeReception = picked.includes('route-reception');

    if (acl || admin || routeReception) {
      names.exchange = await input({ message: 'Main AMQP exchange name', default: d.exchange });
    }
    if (acl) {
      names.aclQueue = await input({ message: 'Queue backing the rlb-acl topic', default: d.aclQueue });
    }
    if (admin || routeReception) {
      names.adminQueue = await input({ message: 'Queue backing the rlb-gateway-admin topic', default: d.adminQueue });
      names.controlTopic = await input({ message: 'Broadcast control/reload topic name', default: d.controlTopic });
    }
    if (routeReception) {
      names.routeExchange = await input({ message: 'Route-discovery exchange (must match the publishers)', default: d.routeExchange });
      names.routeQueue = await input({ message: 'Route-sync queue', default: d.routeQueue });
    }
  } else {
    const picked: string[] = await checkbox({
      message: 'Select microservice features to include',
      choices: [
        { name: 'Auto-send config at startup — publish this service’s @BrokerHTTP routes to the gateway on boot', value: 'auto-config-publish' },
      ],
    });
    autoPublish = picked.includes('auto-config-publish');
    if (autoPublish) {
      names.serviceName = await input({ message: 'Service name (route ownership + AMQP connection_name)', default: d.serviceName });
      names.routeExchange = await input({ message: 'Route-discovery exchange', default: d.routeExchange });
      names.routeQueue = await input({ message: 'Route-sync queue', default: d.routeQueue });
    }
  }

  const skills: boolean = await confirm({ message: 'Copy the Claude skills into .claude/skills?', default: true });
  return { gatewayConfig, acl, admin, routeReception, autoPublish, skills, names };
}

// ---------------------------------------------------------------------------
// config/config.yaml builder
// ---------------------------------------------------------------------------

function buildConfigYaml(sel: Resolved): string {
  const n = sel.names;
  const anyAdmin = sel.admin || sel.routeReception;

  const routeDiscoveryPub = sel.autoPublish ? `
  ***REMOVED*** Route auto-discovery (publisher side): announce this service's @BrokerHTTP routes on boot.
  ***REMOVED*** serviceName also fills the AMQP connection_name (none is set explicitly below).
  routeDiscovery:
    serviceName: "${n.serviceName}"
    publishOnBoot: true
    exchange: ${n.routeExchange}
    queue: ${n.routeQueue}` : '';

  const clientProps = sel.autoPublish ? '' : `
      clientProperties:
        connection_name: "<APP_NAME>"`;

  const exchanges: string[] = [];
  if (sel.acl || anyAdmin) {
    exchanges.push(`    - name: ${n.exchange}
      type: "direct"
      createExchangeIfNotExists: true
      options:
        durable: true`);
  }
  exchanges.push(`    - name: example.fanout
      type: "fanout"
      createExchangeIfNotExists: true
      options:
        durable: true
        autoDelete: false
        internal: false`);

  const queues: string[] = [];
  if (sel.acl) {
    queues.push(`    - name: ${n.aclQueue}
      exchange: ${n.exchange}
      routingKey: ${n.aclQueue}
      createQueueIfNotExists: true
      options:
        durable: true`);
  }
  if (anyAdmin) {
    queues.push(`    - name: ${n.adminQueue}
      exchange: ${n.exchange}
      routingKey: ${n.adminQueue}
      createQueueIfNotExists: true
      options:
        durable: true`);
  }
  queues.push(`    - name: example.queue
      exchange: example.fanout
      routingKey: example.queue
      createQueueIfNotExists: true
      options:
        durable: true
        autoDelete: false
        exclusive: false`);

  const topics: string[] = [];
  if (sel.acl) {
    topics.push(`  ***REMOVED*** Fixed topic name (decorator-bound in the lib): the ACL handlers bind to 'rlb-acl'.
  - name: rlb-acl
    mode: rpc
    queue: ${n.aclQueue}
    exchange: ${n.exchange}
    routingKey: ${n.aclQueue}`);
  }
  if (anyAdmin) {
    topics.push(`  ***REMOVED*** Fixed topic name (decorator-bound): the gateway-admin handlers bind to 'rlb-gateway-admin'.
  - name: rlb-gateway-admin
    mode: rpc
    queue: ${n.adminQueue}
    exchange: ${n.exchange}
    routingKey: ${n.adminQueue}
  ***REMOVED*** Broadcast control topic: the gateway rebuilds its routes at runtime on a 'gw-reload'.
  - name: ${n.controlTopic}
    mode: broadcast
    exchange: ${n.exchange}
    routingKey: ${n.controlTopic}`);
  }
  topics.push(`  - name: example.topic
    exchange: example.fanout
    routingKey: "example.topic"
    mode: event`);

  let yaml = `app:
  port: 80
  host: 0.0.0.0
  environment: "development"

auth-providers: []

broker:
  name: "rabbitmq"
  uri: "<AMQP_URI>"
  defaultSubscribeErrorBehavior: "ack"
  defaultPublishErrorBehavior: "reject"${routeDiscoveryPub}
  connectionManagerOptions:
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:${clientProps}
      credentials:
        mechanism: PLAIN
        username: "<AMQP_USERNAME>"
        password: "<AMQP_PASSWORD>"
  exchanges:
${exchanges.join('\n')}
  queues:
${queues.join('\n')}

topics:
${topics.join('\n')}
`;

  if (sel.gatewayConfig) {
    yaml += '\n' + buildGatewayBlock(sel);
  }
  return yaml;
}

function buildGatewayBlock(sel: Resolved): string {
  const n = sel.names;
  const anyAdmin = sel.admin || sel.routeReception;
  const paths: string[] = [];

  if (sel.acl) paths.push(ACL_PATHS);
  if (sel.admin) paths.push(adminPaths(n.controlTopic));
  paths.push(`    - name: example-path
      method: POST
      dataSource: body
      path: /example
      topic: example.topic
      action: example-action
      mode: event`);

  let block = `gateway:
  events: []
  ws:
    heartbeatIntervalMs: 30000
    ***REMOVED*** Auth is declared per-event (events[].auth / requireAuth / roles / scopeClaim).
  paths:
${paths.join('\n')}`;

  if (anyAdmin) {
    block += `
  ***REMOVED*** Load DB-managed routes at boot AND on every runtime reload (ordered static-before-param).
  loadConfig:
    paths:
      topic: rlb-gateway-admin
      action: gw-path-export
  ***REMOVED*** Broadcast topic that triggers a runtime route rebuild (see topics: ${n.controlTopic}).
  reloadTopic: ${n.controlTopic}
  ***REMOVED*** Per-request metrics auto-emitted to the gateway-admin metrics handler.
  metrics:
    topic: rlb-gateway-admin
    action: gw-metrics-track`;
  }
  return block + '\n';
}

const ACL_PATHS = `    ***REMOVED*** --- ACL management: actions (name is the key — PUT upserts, GET lists, DELETE by name) ---
    - name: acl-action-list
      method: GET
      path: /acl/actions
      dataSource: query
      topic: rlb-acl
      action: acl-action-list
      mode: rpc
    - name: acl-action-get
      method: GET
      path: /acl/actions/get
      dataSource: query
      topic: rlb-acl
      action: acl-action-get
      mode: rpc
    - name: acl-action-upsert
      method: PUT
      path: /acl/actions
      dataSource: body
      topic: rlb-acl
      action: acl-action-update
      mode: rpc
    - name: acl-action-delete
      method: DELETE
      path: /acl/actions
      dataSource: body
      topic: rlb-acl
      action: acl-action-delete
      mode: rpc
    ***REMOVED*** --- ACL management: roles ---
    - name: acl-role-list
      method: GET
      path: /acl/roles
      dataSource: query
      topic: rlb-acl
      action: acl-role-list
      mode: rpc
    - name: acl-role-get
      method: GET
      path: /acl/roles/get
      dataSource: query
      topic: rlb-acl
      action: acl-role-get
      mode: rpc
    - name: acl-role-upsert
      method: PUT
      path: /acl/roles
      dataSource: body
      topic: rlb-acl
      action: acl-role-update
      mode: rpc
    - name: acl-role-delete
      method: DELETE
      path: /acl/roles
      dataSource: body
      topic: rlb-acl
      action: acl-role-delete
      mode: rpc
    ***REMOVED*** --- ACL grants (per-user; resourceId/companyId optional) ---
    - name: acl-grant
      method: POST
      path: /acl/grants
      dataSource: body
      topic: rlb-acl
      action: acl-grant
      mode: rpc
    - name: acl-revoke
      method: DELETE
      path: /acl/grants
      dataSource: body
      topic: rlb-acl
      action: acl-revoke
      mode: rpc
    ***REMOVED*** --- ACL checks (GET → 200 with true/false) ---
    - name: acl-check-gtw
      method: GET
      path: /acl/check
      dataSource: query
      topic: rlb-acl
      action: acl-can-user-do-gtw
      mode: rpc
    - name: acl-check-resource
      method: GET
      path: /acl/check-resource
      dataSource: query
      topic: rlb-acl
      action: acl-can-user-do
      mode: rpc
    ***REMOVED*** Lists the caller's accessible resources. Add an 'auth: <provider>' line once you declare an auth-provider.
    - name: acl-list-resources-by-user
      method: GET
      path: /acl/resources
      dataSource: query
      topic: rlb-acl
      action: acl-list-resources-by-user
      mode: rpc`;

function adminPaths(controlTopic: string): string {
  return `    ***REMOVED*** --- gateway-admin: health + DB routes + auth-providers + metrics ---
    - name: health
      method: GET
      path: /health
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-health
      mode: rpc
    - name: gw-path-create
      method: POST
      path: /admin/paths
      dataSource: body
      topic: rlb-gateway-admin
      action: gw-path-create
      mode: rpc
    - name: gw-path-list
      method: GET
      path: /admin/paths
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-path-list
      mode: rpc
    - name: gw-path-export
      method: GET
      path: /admin/paths/export
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-path-export
      mode: rpc
    - name: gw-path-update
      method: PUT
      path: /admin/paths
      dataSource: body
      topic: rlb-gateway-admin
      action: gw-path-update
      mode: rpc
    - name: gw-path-get
      method: GET
      path: /admin/paths/get
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-path-get
      mode: rpc
    - name: gw-path-delete
      method: DELETE
      path: /admin/paths
      dataSource: body
      topic: rlb-gateway-admin
      action: gw-path-delete
      mode: rpc
    - name: gw-auth-list
      method: GET
      path: /admin/auth
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-auth-list
      mode: rpc
    - name: gw-auth-upsert
      method: PUT
      path: /admin/auth
      dataSource: body
      topic: rlb-gateway-admin
      action: gw-auth-update
      mode: rpc
    - name: gw-auth-get
      method: GET
      path: /admin/auth/get
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-auth-get
      mode: rpc
    - name: gw-auth-delete
      method: DELETE
      path: /admin/auth
      dataSource: body
      topic: rlb-gateway-admin
      action: gw-auth-delete
      mode: rpc
    - name: gw-metrics-get
      method: GET
      path: /admin/metrics
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-metrics-get
      mode: rpc
    - name: gw-metrics-series
      method: GET
      path: /admin/metrics/series
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-metrics-series
      mode: rpc
    - name: gw-metrics-points
      method: GET
      path: /admin/metrics/points
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-metrics-points
      mode: rpc
    - name: gw-metrics-track
      method: POST
      path: /admin/metrics/track
      dataSource: body
      topic: rlb-gateway-admin
      action: gw-metrics-track
      mode: event
    - name: gw-reload
      method: POST
      path: /admin/reload
      dataSource: body
      topic: ${controlTopic}
      action: gw-reload
      mode: event`;
}

// ---------------------------------------------------------------------------
// AppModule wiring (import statements + @Module imports entries)
// ---------------------------------------------------------------------------

function buildImportStatements(sel: Resolved): string {
  const libSymbols = ['AppConfig', 'BrokerModule', 'BrokerTopic', 'RabbitMQConfig'];
  if (sel.gatewayConfig) libSymbols.push('GatewayConfig', 'HandlerAuthConfig', 'ProxyModule');
  if (sel.acl) libSymbols.push('AclActionRepository', 'AclGrantRepository', 'AclModule', 'AclRoleRepository', 'AclService', 'RLB_ACL_CACHE_STORE', 'RLB_GTW_ACL_ROLE_SERVICE');
  if (sel.admin || sel.routeReception) libSymbols.push('AuthProviderRepository', 'GatewayAdminModule', 'HttpMetricRepository', 'HttpPathRepository', 'RouteSyncLogRepository');
  const lib = `import { ${[...new Set(libSymbols)].sort().join(', ')} } from '@open-rlb/nestjs-amqp';`;

  const lines = [lib, `import { ConfigModule, ConfigService } from '@nestjs/config';`, `import yamlConfig from './config/config.loader';`];
  if (sel.gatewayConfig) lines.push(`import { HttpModule } from '@nestjs/axios';`);
  if (sel.acl) {
    lines.push(`import { InMemoryAclActionRepository, InMemoryAclGrantRepository, InMemoryAclRoleRepository } from './modules/database/repository/acl.repository';`);
    lines.push(`import { InMemoryAclStore } from './cache/in-memory-acl-store';`);
  }
  if (sel.admin || sel.routeReception) {
    lines.push(`import { InMemoryAuthProviderRepository, InMemoryHttpMetricRepository, InMemoryHttpPathRepository } from './modules/database/repository/gateway.repository';`);
    lines.push(`import { InMemoryRouteSyncLogRepository } from './modules/database/repository/route-sync.repository';`);
  }
  return lines.join('\n');
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

function proxyForRootAsync(sel: Resolved): string {
  const providers = sel.acl
    ? `[
        // Role-gated paths resolve the caller's roles via AclService (in-process, no broker hop).
        { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },
      ]`
    : `[]`;
  return `ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        authOptions: configService.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: configService.get<GatewayConfig>('gateway'),
      }),
      providers: ${providers},
    })`;
}

function aclForRoot(): string {
  return `AclModule.forRoot(
      [
        InMemoryAclActionRepository,
        { provide: AclActionRepository, useExisting: InMemoryAclActionRepository },
        InMemoryAclRoleRepository,
        { provide: AclRoleRepository, useExisting: InMemoryAclRoleRepository },
        InMemoryAclGrantRepository,
        { provide: AclGrantRepository, useExisting: InMemoryAclGrantRepository },
        InMemoryAclStore,
        { provide: RLB_ACL_CACHE_STORE, useExisting: InMemoryAclStore },
      ],
      { cache: { ramTtlMs: 30000, l2TtlSec: 600 } },
    )`;
}

function gatewayAdminForRoot(sel: Resolved): string {
  const options = sel.routeReception
    ? `,
      {
        // Consumer-side route-discovery — names MUST match the publishers' broker.routeDiscovery.
        routeDiscovery: { exchange: '${sel.names.routeExchange}', queue: '${sel.names.routeQueue}' },
      }`
    : '';
  return `GatewayAdminModule.forRoot(
      [
        InMemoryHttpPathRepository,
        { provide: HttpPathRepository, useExisting: InMemoryHttpPathRepository },
        InMemoryAuthProviderRepository,
        { provide: AuthProviderRepository, useExisting: InMemoryAuthProviderRepository },
        InMemoryHttpMetricRepository,
        { provide: HttpMetricRepository, useExisting: InMemoryHttpMetricRepository },
        InMemoryRouteSyncLogRepository,
        { provide: RouteSyncLogRepository, useExisting: InMemoryRouteSyncLogRepository },
      ]${options},
    )`;
}

function buildModuleEntries(sel: Resolved): string[] {
  const entries: string[] = [];
  entries.push(`ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] })`);
  entries.push(brokerForRootAsync());
  if (sel.gatewayConfig) {
    entries.push('HttpModule');
    entries.push(proxyForRootAsync(sel));
  }
  if (sel.acl) entries.push(aclForRoot());
  if (sel.admin || sel.routeReception) entries.push(gatewayAdminForRoot(sel));
  return entries;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function main(options: InitOptions): Rule {
  const project = (options.project || 'my-service').toString();
  options = transform(options);
  return async (tree: Tree, context: SchematicContext) => {
    const sel = await resolveSelections({ ...options, project } as InitOptions, context);
    const anyRepo = sel.acl || sel.admin || sel.routeReception;
    return branchAndMerge(
      chain([
        mergeSourceRoot(options),
        addModulesToAppModule(sel),
        createConfigLoader(),
        updateConfigYaml(sel),
        sel.gatewayConfig ? configureMainForGateway() : noop(),
        anyRepo ? copyAsset('db-core') : noop(),
        sel.acl ? copyAsset('acl') : noop(),
        (sel.admin || sel.routeReception) ? copyAsset('gateway-admin') : noop(),
        sel.skills ? copySkills() : noop(),
        updatePackageJson(sel),
      ]),
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function transform(source: InitOptions): InitOptions {
  const target: InitOptions = Object.assign({}, source);
  target.metadata = 'providers';
  target.type = 'module';
  target.language = 'ts';
  const location: Location = new NameParser().parse({ ...target, name: 'init' });
  target.name = '';
  target.path = normalizeToKebabOrSnakeCase(location.path);
  target.specFileSuffix = normalizeToKebabOrSnakeCase(source.specFileSuffix || 'spec');
  return target;
}

/** Copy a static asset tree under ./files/<name> to the project root (no templating). */
function copyAsset(name: string): Rule {
  return mergeWith(apply(url(`./files/${name}`), [move(normalize('.'))]), MergeStrategy.Overwrite);
}

/** Copy the Claude skills tree to .claude/skills. */
function copySkills(): Rule {
  return mergeWith(apply(url('./files/skills'), [move(normalize('.claude/skills'))]), MergeStrategy.Overwrite);
}

/** Create src/config/config.loader.ts (js-yaml loader) if it doesn't exist yet. */
function createConfigLoader(): Rule {
  return (tree: Tree) => {
    const path = 'src/config/config.loader.ts';
    if (tree.exists(path)) return tree;
    tree.create(path, `import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const YAML_CONFIG_FILENAME = 'config/config.yaml';

export default () =>
  yaml.load(readFileSync(join(process.cwd(), YAML_CONFIG_FILENAME), 'utf8')) as Record<string, any>;
`);
    return tree;
  };
}

function updateConfigYaml(sel: Resolved): Rule {
  return (tree: Tree) => {
    const CONFIG_PATH = 'config/config.yaml';
    const block = buildConfigYaml(sel);

    if (!tree.exists(CONFIG_PATH)) {
      tree.create(CONFIG_PATH, block);
      return tree;
    }

    // Existing file: append only the still-missing top-level sections.
    const existing = tree.read(CONFIG_PATH)!.toString('utf-8');
    const SECTION_KEYS = ['app:', 'auth-providers:', 'broker:', 'topics:', ...(sel.gatewayConfig ? ['gateway:'] : [])] as const;

    let toAppend = '';
    for (const key of SECTION_KEYS) {
      if (!existing.includes(key)) {
        const section = extractYamlSection(block, key);
        if (section) toAppend += '\n' + section + '\n';
      }
    }
    if (toAppend.length > 0) {
      tree.overwrite(CONFIG_PATH, existing.trimEnd() + '\n' + toAppend);
    }
    return tree;
  };
}

/** Extracts the YAML block starting at `sectionKey` up to the next top-level key. */
function extractYamlSection(yaml: string, sectionKey: string): string {
  const lines = yaml.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(sectionKey));
  if (startIdx === -1) return '';
  const endIdx = lines.findIndex((l, i) => i > startIdx && l.length > 0 && !l.startsWith(' ') && !l.startsWith('***REMOVED***'));
  const sectionLines = endIdx === -1 ? lines.slice(startIdx) : lines.slice(startIdx, endIdx);
  return sectionLines.join('\n').trimEnd();
}

function addModulesToAppModule(sel: Resolved): Rule {
  return (tree: Tree) => {
    const candidatePaths = ['/src/app.module.ts', '/app/app.module.ts', 'src/app.module.ts', 'app/app.module.ts'];
    let modulePath: string | undefined = candidatePaths.find((p) => tree.exists(p)) || findFileInTree(tree, 'app.module.ts');
    if (!modulePath) {
      console.warn('[nest-add] app.module.ts not found: AppModule wiring skipped.');
      return tree;
    }

    const raw = tree.read(modulePath);
    if (!raw) return tree;
    let content = raw.toString('utf-8');

    // Sentinel: BrokerModule.forRootAsync means "already wired" → idempotent no-op.
    if (content.includes('BrokerModule.forRootAsync')) return tree;

    if (!content.includes('@open-rlb/nestjs-amqp')) {
      const pos = findLastImportEndIndex(content);
      content = content.slice(0, pos) + '\n' + buildImportStatements(sel) + content.slice(pos);
    }

    // Insert the module entries (reverse so the final order matches buildModuleEntries()).
    const entries = buildModuleEntries(sel);
    for (let i = entries.length - 1; i >= 0; i--) {
      content = insertIntoImportsArray(content, entries[i]);
    }

    tree.overwrite(modulePath, content);
    return tree;
  };
}

function configureMainForGateway(): Rule {
  return (tree: Tree) => {
    const candidatePaths = ['/src/main.ts', '/app/main.ts', 'src/main.ts', 'app/main.ts'];
    const mainPath = candidatePaths.find((p) => tree.exists(p)) || findFileInTree(tree, 'main.ts');
    if (!mainPath) {
      console.warn('[nest-add] main.ts not found: enable rawBody + WsAdapter manually.');
      return tree;
    }
    let content = tree.read(mainPath)!.toString('utf-8');
    if (content.includes('WsAdapter')) return tree;

    const pos = findLastImportEndIndex(content);
    content = content.slice(0, pos) + "\nimport { WsAdapter } from '@nestjs/platform-ws';" + content.slice(pos);

    const m = content.match(/const\s+(\w+)\s*=\s*await\s+NestFactory\.create\(\s*([A-Za-z0-9_]+)\s*(,\s*\{[^}]*\})?\s*\)\s*;?/);
    if (m) {
      const appVar = m[1];
      const moduleArg = m[2];
      const replacement = `const ${appVar} = await NestFactory.create(${moduleArg}, { rawBody: true });\n  ${appVar}.useWebSocketAdapter(new WsAdapter(${appVar}));\n  ${appVar}.enableShutdownHooks();`;
      content = content.replace(m[0], replacement);
    } else {
      console.warn('[nest-add] NestFactory.create() not found in main.ts: add { rawBody: true } + useWebSocketAdapter manually.');
    }

    tree.overwrite(mainPath, content);
    return tree;
  };
}

/** Inserts `moduleEntry` at the head of the first `imports: [...]` array in the @Module decorator. */
function insertIntoImportsArray(source: string, moduleEntry: string): string {
  const match = /imports\s*:\s*\[/.exec(source);
  if (!match) return source;
  const openBracketPos = source.indexOf('[', match.index);

  let depth = 0;
  let closeBracketPos = -1;
  for (let i = openBracketPos; i < source.length; i++) {
    if (source[i] === '[') depth++;
    else if (source[i] === ']') {
      depth--;
      if (depth === 0) { closeBracketPos = i; break; }
    }
  }
  if (closeBracketPos === -1) return source;

  const arrayContent = source.slice(openBracketPos + 1, closeBracketPos).trim();
  const newArrayContent = arrayContent.length === 0
    ? `\n    ${moduleEntry},\n  `
    : `\n    ${moduleEntry},\n    ${arrayContent}\n  `;
  return source.slice(0, openBracketPos + 1) + newArrayContent + source.slice(closeBracketPos);
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

function findFileInTree(tree: Tree, fileName: string): string | undefined {
  let found: string | undefined;
  tree.visit((path) => {
    if (!found && path.endsWith(`/${fileName}`)) found = path;
  });
  return found;
}

// ---------------------------------------------------------------------------
// package.json: add the runtime deps the generated code imports.
// ---------------------------------------------------------------------------

function updatePackageJson(sel: Resolved): Rule {
  return (host: Tree) => {
    if (!host.exists('package.json')) return host;
    return updateJsonFile(host, 'package.json', (packageJson: Record<string, any>) => {
      packageJson.dependencies = packageJson.dependencies || {};
      const add = (name: string, version: string) => {
        if (!packageJson.dependencies[name]) packageJson.dependencies[name] = version;
      };
      add('@nestjs/config', '^4.0.4');
      add('js-yaml', '^4.1.0');
      if (sel.gatewayConfig) {
        add('@nestjs/axios', '^4.0.1');
        add('@nestjs/platform-ws', '^11.0.1');
        add('@nestjs/websockets', '^11.0.1');
        add('ws', '^8.21.0');
      }
    });
  };
}

function updateJsonFile<T>(host: Tree, path: string, callback: UpdateJsonFn<T>): Tree {
  const source = host.read(path);
  if (source) {
    const json = parse(source.toString('utf-8'));
    callback(json as unknown as T);
    host.overwrite(path, JSON.stringify(json, null, 2));
  }
  return host;
}
