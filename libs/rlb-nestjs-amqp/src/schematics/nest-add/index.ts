import { apply, MergeStrategy, mergeWith, move, noop, Rule, SchematicContext, Tree, url } from '@angular-devkit/schematics';
import { normalize } from 'path';
import {
  addDeps,
  brokerModuleEntry,
  configModuleEntry,
  coreImportLines,
  coreLibSymbols,
  createConfigLoader,
  wireAppModule,
} from '../utils/nest-wiring.util';
import { askConfirm, loadPrompts } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { InitOptions } from './init.schema';

/**
 * `nest add @open-rlb/nestjs-amqp` — the CORE bootstrap. The `nest add` runner installs the package;
 * this schematic then lays down the minimum a plain AMQP microservice needs: a base `config.yaml`,
 * the config loader, and the ConfigModule + BrokerModule wiring in AppModule. It stops there — the
 * gateway, ACL, topics, routes, retry, … are added on demand by the focused schematics (`add-gateway`,
 * `add-topic`, `add-route`, `enable-retry`, …). Finally it offers to drop the Claude skills / project
 * docs into `.claude/skills`. Every step is idempotent.
 */
export function main(options: InitOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const prompts = loadPrompts(context, options.skills !== undefined);
    const skills = options.skills ?? (await askConfirm(prompts, 'Add the Claude skills / project docs into .claude/skills?', true));

    // 1. Base config.yaml (create when missing; only backfill missing top-level sections otherwise).
    ensureBaseConfig(tree, options.config, context);

    // 2. Config loader + core module wiring + runtime deps.
    createConfigLoader(tree);
    const modulePath = wireAppModule(tree, {
      libSymbols: coreLibSymbols(),
      importLines: coreImportLines(),
      entries: [configModuleEntry(), brokerModuleEntry()],
    });
    if (!modulePath) {
      context.logger.warn('[nest-add] app.module.ts not found — wire ConfigModule + BrokerModule.forRootAsync manually.');
    }
    addDeps(tree, { '@nestjs/config': '^4.0.4', 'js-yaml': '^4.1.0' });

    context.logger.info('[nest-add] core ready. Use `add-gateway`, `add-topic`, `add-route`, `enable-retry`, … to add features.');

    // 3. Skills / project docs (applied by the engine as a returned Rule).
    return skills ? copySkills() : noop();
  };
}

/**
 * Ensure a base config.yaml exists. A missing file gets the full commented template; an existing one
 * is only backfilled with any missing top-level section (app/broker/topics) so user edits survive.
 */
function ensureBaseConfig(tree: Tree, preferred: string | undefined, context: SchematicContext): void {
  const configPath = findConfigYaml(tree, preferred);
  if (!tree.exists(configPath)) {
    tree.create(configPath, BASE_CONFIG_YAML);
    context.logger.info(`[nest-add] created ${configPath}.`);
    return;
  }
  const { doc } = readConfigDoc(tree, configPath);
  if (!doc.hasIn(['app'])) setIn(doc, ['app'], { port: 80, host: '0.0.0.0', environment: 'development' });
  if (!doc.hasIn(['broker'])) setIn(doc, ['broker'], { name: 'rabbitmq', uri: '<AMQP_URI>' });
  if (!doc.hasIn(['topics'])) setIn(doc, ['topics'], []);
  writeConfigDoc(tree, configPath, doc);
}

const BASE_CONFIG_YAML = `app:
  port: 80
  host: 0.0.0.0
  environment: "development"

broker:
  name: "rabbitmq"
  uri: "<AMQP_URI>"
  connectionManagerOptions:
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        # Logical name — the library appends -<hostname>-<pid> per instance.
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
  queues:
    - name: example.queue
      exchange: example.fanout
      routingKey: example.queue
      createQueueIfNotExists: true
      options:
        durable: true

topics:
  - name: example.topic
    exchange: example.fanout
    routingKey: "example.topic"
    mode: event
`;

/** Copy the Claude skills (the project's Claude-facing docs) into .claude/skills. */
function copySkills(): Rule {
  return mergeWith(apply(url('./files/skills'), [move(normalize('.claude/skills'))]), MergeStrategy.Overwrite);
}
