import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { ConfigureBrokerOptions } from './schema';

const MANAGER = ['broker', 'connectionManagerOptions'];
const CREDS = [...MANAGER, 'connectionOptions', 'credentials'];

/**
 * `configure-broker` — set broker connection scalars, ONLY for values that were actually provided
 * (so re-running with a single flag never clobbers the rest of the config). Mostly non-interactive:
 * it just applies whatever flags were passed.
 */
export function main(options: ConfigureBrokerOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    // `uri` is the closest thing to a primary field; otherwise this schematic is flag-driven.
    const flagsProvided = options.uri !== undefined;
    loadPrompts(context, flagsProvided);

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    // (option value, target path, label) — only entries whose value is defined get applied.
    const edits: Array<[unknown, (string | number)[], string]> = [
      [options.uri, ['broker', 'uri'], 'broker.uri'],
      [options.prefetchCount, ['broker', 'prefetchCount'], 'broker.prefetchCount'],
      [options.defaultRpcTimeout, ['broker', 'defaultRpcTimeout'], 'broker.defaultRpcTimeout'],
      [options.heartbeatIntervalInSeconds, [...MANAGER, 'heartbeatIntervalInSeconds'], 'heartbeatIntervalInSeconds'],
      [options.reconnectTimeInSeconds, [...MANAGER, 'reconnectTimeInSeconds'], 'reconnectTimeInSeconds'],
      [options.mechanism, [...CREDS, 'mechanism'], 'credentials.mechanism'],
      [options.username, [...CREDS, 'username'], 'credentials.username'],
      [options.password, [...CREDS, 'password'], 'credentials.password'],
    ];

    let applied = 0;
    for (const [value, path, label] of edits) {
      if (value === undefined) continue;
      logOutcome(context, label, setIn(doc, path, value));
      applied++;
    }

    if (applied === 0) {
      context.logger.warn('[rlb-amqp] configure-broker: no options provided — nothing to set.');
      return tree;
    }

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
