import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { ensureExchange, ensureQueue, ExchangeType } from '../utils/broker-yaml.util';
import { askConfirm, askSelect, askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, writeConfigDoc } from '../utils/yaml-config.util';
import { AddExchangeOptions } from './schema';

const TYPES: readonly ExchangeType[] = ['direct', 'topic', 'fanout', 'headers'];

/**
 * `add-exchange <name>` — idempotent upsert of a `broker.exchanges[]` entry, comment-preserving.
 * When interactive it also offers to create a queue bound to the exchange (default queue name =
 * exchange name). Creating that queue calls the ensureQueue DATA helper directly — NOT the
 * add-queue schematic — so there is no "create exchange? → create queue? → …" prompt ping-pong.
 */
export function main(options: AddExchangeOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.name !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const name = options.name || (await askText(prompts, 'Exchange name?', ''));
    if (!name) {
      context.logger.error('[rlb-amqp] add-exchange: a name is required.');
      return tree;
    }

    const type = (options.type as ExchangeType) || (await askSelect(prompts, 'Exchange type?', TYPES, 'direct'));

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    const outcome = ensureExchange(
      doc,
      {
        name,
        type,
        createExchangeIfNotExists: options.createIfNotExists ?? true,
        durable: options.durable ?? true,
        autoDelete: options.autoDelete ?? false,
        internal: options.internal ?? false,
      },
      { overwrite: options.overwrite },
    );
    logOutcome(context, `exchange '${name}'`, outcome);

    // Offer to bind a queue. In non-interactive mode this fires only when --with-queue was passed.
    const withQueue = options.withQueue ?? (await askConfirm(prompts, `Create a queue bound to '${name}'?`, false));
    if (withQueue) {
      const queueName = options.queueName || (await askText(prompts, 'Queue name?', name));
      const needsRoutingKey = type === 'topic';
      const routingKey = needsRoutingKey ? options.routingKey || queueName : options.routingKey;
      const qOutcome = ensureQueue(doc, {
        name: queueName,
        exchange: name,
        routingKey,
        createQueueIfNotExists: true,
        durable: true,
      });
      logOutcome(context, `queue '${queueName}'`, qOutcome);
    }

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
