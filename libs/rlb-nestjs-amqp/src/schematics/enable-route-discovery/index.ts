import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { ensureExchange } from '../utils/broker-yaml.util';
import { normalizeToKebabOrSnakeCase } from '../utils/formatting';
import { askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { EnableRouteDiscoveryOptions } from './schema';

/**
 * `enable-route-discovery` — publisher-side route auto-discovery: the service publishes its route
 * manifest on a fanout exchange so a gateway can sync it. Declares that fanout exchange automatically
 * so the discovery wiring is complete in one shot.
 */
export function main(options: EnableRouteDiscoveryOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.serviceName !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const rawName = options.serviceName || (await askText(prompts, 'Service name?', ''));
    if (!rawName) {
      context.logger.error('[rlb-amqp] enable-route-discovery: a serviceName is required.');
      return tree;
    }
    const svc = normalizeToKebabOrSnakeCase(rawName);
    const exchange = options.exchange || 'rlb-route-discovery';
    const queue = options.queue || 'rlb-route-sync';
    const publishOnBoot = options.publishOnBoot ?? true;

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    const outcome = setIn(doc, ['broker', 'routeDiscovery'], { serviceName: svc, publishOnBoot, exchange, queue });
    logOutcome(context, 'broker.routeDiscovery', outcome);

    // A fanout exchange is the discovery bus; declare it so publish-on-boot has somewhere to go.
    if (options.declareExchange ?? true) {
      const exOutcome = ensureExchange(doc, { name: exchange, type: 'fanout' });
      logOutcome(context, `discovery exchange '${exchange}'`, exOutcome);
    }

    context.logger.info(
      `[rlb-amqp] serviceName '${svc}' also fills connection_name when none is set (see set-connection-name).`,
    );

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
