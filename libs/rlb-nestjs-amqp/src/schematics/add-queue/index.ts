import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import {
  ensureExchange,
  ensureQueue,
  exchangeExists,
  ExchangeType,
  routingKeyRequired,
} from '../utils/broker-yaml.util';
import { askConfirm, askSelect, askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, writeConfigDoc } from '../utils/yaml-config.util';
import { AddQueueOptions } from './schema';

const TYPES: readonly ExchangeType[] = ['direct', 'topic', 'fanout', 'headers'];

/**
 * `add-queue <name>` — idempotent upsert of a `broker.queues[]` entry, comment-preserving.
 * When the target exchange is missing it can create it via the ensureExchange DATA helper (never the
 * add-exchange schematic) so there is no cross-schematic prompt ping-pong. Topic exchanges require a
 * routingKey, so we default it to the queue name when the exchange is (or is being created as) topic.
 */
export function main(options: AddQueueOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.name !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const name = options.name || (await askText(prompts, 'Queue name?', ''));
    if (!name) {
      context.logger.error('[rlb-amqp] add-queue: a name is required.');
      return tree;
    }

    const exchange = options.exchange || (await askText(prompts, 'Bind to which exchange?', 'rlb'));

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    // Create the exchange first when missing so the queue never dangles. Offer defaults to false
    // interactively; passing --create-exchange (or its type) opts in non-interactively.
    if (!exchangeExists(doc, exchange)) {
      const createExchange = options.createExchange ?? (await askConfirm(prompts, `Exchange '${exchange}' is missing — create it?`, false));
      if (createExchange) {
        const exchangeType =
          (options.exchangeType as ExchangeType) || (await askSelect(prompts, `Type for exchange '${exchange}'?`, TYPES, 'direct'));
        const exOutcome = ensureExchange(doc, { name: exchange, type: exchangeType });
        logOutcome(context, `exchange '${exchange}'`, exOutcome);
      }
    }

    // Topic exchanges MUST carry a routingKey; default it to the queue name when unspecified.
    const routingKey = routingKeyRequired(doc, exchange) ? options.routingKey || name : options.routingKey;

    const outcome = ensureQueue(
      doc,
      {
        name,
        exchange,
        routingKey,
        createQueueIfNotExists: options.createIfNotExists ?? true,
        durable: options.durable ?? true,
        exclusive: options.exclusive ?? false,
        autoDelete: options.autoDelete ?? false,
        messageTtl: options.messageTtl,
        maxLength: options.maxLength,
        expires: options.expires,
      },
      { overwrite: options.overwrite },
    );
    logOutcome(context, `queue '${name}'`, outcome);

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
