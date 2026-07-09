import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { EnableLoadConfigOptions } from './schema';

/**
 * `enable-load-config` — add `gateway.loadConfig.paths` (and optionally `.events`) so the gateway
 * pulls DB-managed routes/events and merges them with the YAML paths on every (re)load. Idempotent
 * + comment-preserving.
 */
export function main(options: EnableLoadConfigOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.pathsTopic !== undefined || options.eventsTopic !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const pathsTopic = options.pathsTopic || (await askText(prompts, 'Paths export topic?', 'rlb-gateway-admin'));
    const pathsAction = options.pathsAction || (await askText(prompts, 'Paths export action?', 'gw-path-export'));

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    const pOutcome = setIn(doc, ['gateway', 'loadConfig', 'paths'], { topic: pathsTopic, action: pathsAction });
    logOutcome(context, 'gateway.loadConfig.paths', pOutcome);

    if (options.eventsTopic && options.eventsAction) {
      const eOutcome = setIn(doc, ['gateway', 'loadConfig', 'events'], {
        topic: options.eventsTopic,
        action: options.eventsAction,
      });
      logOutcome(context, 'gateway.loadConfig.events', eOutcome);
    } else if (options.eventsTopic || options.eventsAction) {
      context.logger.warn('[rlb-amqp] enable-load-config: events needs BOTH eventsTopic and eventsAction — skipped.');
    }

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
