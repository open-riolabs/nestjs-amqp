import { apply, chain, MergeStrategy, mergeWith, move, noop, Rule, SchematicContext, Tree, url } from '@angular-devkit/schematics';
import { normalize } from 'path';
import { ensureExchange, ensureQueue, ensureTopic } from '../utils/broker-yaml.util';
import { addDeps, configureMainForGateway, createConfigLoader, wireAppModule } from '../utils/nest-wiring.util';
import { findConfigYaml, readConfigDoc, setIn, upsertSeqItemByKey, writeConfigDoc } from '../utils/yaml-config.util';
import { aclManagementPaths, adminManagementPaths } from './paths';
import { AddGatewayOptions } from './schema';
import { GwFeatures, importLines, libSymbols, moduleEntries } from './wiring';

/**
 * `add-gateway` — promote a plain microservice into a working gateway. It edits config.yaml (drop
 * publisher route-discovery; declare the acl/admin/control + route-sync infra; seed the `gateway:`
 * section AND its management routes) AND wires the app: AppModule (Broker/Proxy/Http/Acl/GatewayAdmin
 * modules), main.ts (rawBody + WsAdapter), the config loader, in-memory repositories, and package.json
 * deps. Every step is idempotent, so re-running (or running on an already-partly-wired app) is safe.
 */
export function main(options: AddGatewayOptions): Rule {
  const r = resolveFlags(options);
  return chain([
    // Config edits + TypeScript wiring (directly unit-testable — no engine/url source needed).
    configAndWireRule(options),
    // In-memory starter repositories referenced by the wiring (Overwrite = idempotent re-copy).
    copyAsset('db-core'),
    r.acl ? copyAsset('acl') : noop(),
    r.anyAdmin ? copyAsset('gateway-admin') : noop(),
  ]);
}

interface Resolved {
  exchange: string;
  aclQueue: string;
  adminQueue: string;
  controlTopic: string;
  routeExchange: string;
  routeQueue: string;
  acl: boolean;
  admin: boolean;
  routeReception: boolean;
  anyAdmin: boolean;
  features: GwFeatures;
}

function resolveFlags(options: AddGatewayOptions): Resolved {
  const exchange = options.exchange || 'rlb';
  const aclQueue = options.aclQueue || 'rlb-acl';
  const adminQueue = options.adminQueue || 'rlb-gateway-admin';
  const controlTopic = options.controlTopic || 'rlb-gateway-control';
  const routeExchange = options.routeExchange || 'rlb-route-discovery';
  const routeQueue = options.routeQueue || 'rlb-route-sync';
  const acl = options.acl ?? true;
  const admin = options.admin ?? true;
  const routeReception = options.routeReception ?? true;
  const anyAdmin = admin || routeReception;
  const features: GwFeatures = { acl, admin, routeReception, routeExchange, routeQueue };
  return { exchange, aclQueue, adminQueue, controlTopic, routeExchange, routeQueue, acl, admin, routeReception, anyAdmin, features };
}

/** The config.yaml edits + config-loader/AppModule/main.ts/package.json wiring — everything except the
 *  url()-based asset copy, so it can be invoked directly against a Tree in unit tests. */
export function configAndWireRule(options: AddGatewayOptions): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const r = resolveFlags(options);
    const opts = { overwrite: options.overwrite };
    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    // 1. A gateway consumes routes, it does not publish its own → drop publisher route-discovery.
    if (doc.hasIn(['broker', 'routeDiscovery'])) {
      doc.deleteIn(['broker', 'routeDiscovery']);
      context.logger.info('[rlb-amqp] removed broker.routeDiscovery (a gateway consumes routes, it does not publish its own).');
    }

    // 2. Main exchange backing the acl/admin queues.
    ensureExchange(doc, { name: r.exchange, type: 'direct' }, opts);

    // 3. ACL infra — topic name is FIXED 'rlb-acl' (decorator-bound in the lib).
    if (r.acl) {
      ensureQueue(doc, { name: r.aclQueue, exchange: r.exchange, routingKey: r.aclQueue, durable: true }, opts);
      ensureTopic(doc, { name: 'rlb-acl', mode: 'rpc', queue: r.aclQueue, exchange: r.exchange, routingKey: r.aclQueue }, opts);
    }

    // 4. Gateway-admin infra — 'rlb-gateway-admin' is decorator-bound; controlTopic is a broadcast.
    if (r.anyAdmin) {
      ensureQueue(doc, { name: r.adminQueue, exchange: r.exchange, routingKey: r.adminQueue, durable: true }, opts);
      ensureTopic(doc, { name: 'rlb-gateway-admin', mode: 'rpc', queue: r.adminQueue, exchange: r.exchange, routingKey: r.adminQueue }, opts);
      ensureTopic(doc, { name: r.controlTopic, mode: 'broadcast', exchange: r.exchange, routingKey: r.controlTopic }, opts);
    }

    // 5. Consumer-side route-sync infra (fanout exchange + durable sync queue).
    if (r.routeReception) {
      ensureExchange(doc, { name: r.routeExchange, type: 'fanout' }, opts);
      ensureQueue(doc, { name: r.routeQueue, exchange: r.routeExchange, durable: true }, opts);
    }

    // 6. gateway: section — set each key ONLY if absent, so user edits are never clobbered.
    if (!doc.hasIn(['gateway', 'events'])) setIn(doc, ['gateway', 'events'], []);
    if (!doc.hasIn(['gateway', 'ws'])) setIn(doc, ['gateway', 'ws'], { heartbeatIntervalMs: 30000 });
    if (r.anyAdmin) {
      if (!doc.hasIn(['gateway', 'reloadTopic'])) setIn(doc, ['gateway', 'reloadTopic'], r.controlTopic);
      if (!doc.hasIn(['gateway', 'metrics'])) setIn(doc, ['gateway', 'metrics'], { topic: 'rlb-gateway-admin', action: 'gw-metrics-track' });
      if (!doc.hasIn(['gateway', 'loadConfig'])) setIn(doc, ['gateway', 'loadConfig'], { paths: { topic: 'rlb-gateway-admin', action: 'gw-path-export' } });
    }

    // 7. Management routes so the wired ACL / gateway-admin modules are reachable over HTTP.
    if (!doc.hasIn(['gateway', 'paths'])) setIn(doc, ['gateway', 'paths'], []);
    const paths = [...(r.acl ? aclManagementPaths() : []), ...(r.anyAdmin ? adminManagementPaths(r.controlTopic) : [])];
    for (const p of paths) upsertSeqItemByKey(doc, ['gateway', 'paths'], 'name', p as unknown as Record<string, unknown>, opts);

    writeConfigDoc(tree, configPath, doc);

    // 8. TypeScript wiring: config loader, AppModule modules, main.ts, package.json deps.
    createConfigLoader(tree);
    const modulePath = wireAppModule(tree, {
      libSymbols: libSymbols(r.features),
      importLines: importLines(r.features),
      entries: moduleEntries(r.features),
    });
    if (!modulePath) {
      context.logger.warn('[rlb-amqp] app.module.ts not found — module wiring skipped. Wire Broker/Proxy/Http' + (r.acl ? '/Acl' : '') + (r.anyAdmin ? '/GatewayAdmin' : '') + ' modules manually.');
    }
    if (!configureMainForGateway(tree)) {
      context.logger.warn('[rlb-amqp] main.ts not found — enable rawBody + WsAdapter manually.');
    }
    addDeps(tree, {
      '@nestjs/config': '^4.0.4',
      'js-yaml': '^4.1.0',
      '@nestjs/axios': '^4.0.1',
      '@nestjs/platform-ws': '^11.0.1',
      '@nestjs/websockets': '^11.0.1',
      ws: '^8.21.0',
    });

    return tree;
  };
}

/** Copy a static in-memory-repository asset tree under ./files/<name> to the project root. */
function copyAsset(name: string): Rule {
  return mergeWith(apply(url(`./files/${name}`), [move(normalize('.'))]), MergeStrategy.Overwrite);
}
