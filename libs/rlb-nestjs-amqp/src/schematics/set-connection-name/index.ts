import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { SetConnectionNameOptions } from './schema';

const CONNECTION_NAME_PATH = [
  'broker',
  'connectionManagerOptions',
  'connectionOptions',
  'clientProperties',
  'connection_name',
];

/**
 * `set-connection-name` — set the LOGICAL connection_name. In 2.1.x the library auto-appends
 * `-<hostname>-<pid>` per instance, so replicas can share one config while still showing up
 * distinctly in the broker. The name is trimmed but intentionally NOT kebab-normalized.
 */
export function main(options: SetConnectionNameOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.name !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const raw = options.name || (await askText(prompts, 'Logical connection name?', ''));
    const name = raw.trim();
    if (!name) {
      context.logger.error('[rlb-amqp] set-connection-name: a name is required.');
      return tree;
    }

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    const outcome = setIn(doc, CONNECTION_NAME_PATH, name);
    logOutcome(context, `connection_name '${name}'`, outcome);
    context.logger.info('[rlb-amqp] logical name; the library appends -hostname-pid per instance.');

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
