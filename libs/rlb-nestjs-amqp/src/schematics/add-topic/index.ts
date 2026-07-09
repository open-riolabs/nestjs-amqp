import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import {
  ensureExchange,
  ensureQueue,
  ensureTopic,
  exchangeExists,
  queueExists,
  RetrySpec,
  routingKeyRequired,
  TopicMode,
} from '../utils/broker-yaml.util';
import { askConfirm, askSelect, askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, writeConfigDoc } from '../utils/yaml-config.util';
import { AddTopicOptions } from './schema';

const MODES: readonly TopicMode[] = ['rpc', 'handle', 'broadcast', 'event'];

/**
 * `add-topic <name>` — idempotent upsert of a `topics[]` entry, comment-preserving.
 * rpc/handle modes consume a queue, so we create the queue (and its exchange) via the ensureQueue/
 * ensureExchange DATA helpers — never sibling schematics — to avoid prompt ping-pong. Any retry* flag
 * builds a `retry` object; the dead-letter exchange itself is owned by the enable-retry schematic, so
 * we deliberately never emit `retry.deadLetter` here.
 */
export function main(options: AddTopicOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.name !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const name = options.name || (await askText(prompts, 'Topic name?', ''));
    if (!name) {
      context.logger.error('[rlb-amqp] add-topic: a name is required.');
      return tree;
    }

    const mode = (options.mode as TopicMode) || (await askSelect(prompts, 'Topic mode?', MODES, 'rpc'));
    const exchange = options.exchange || (await askText(prompts, 'Exchange?', 'rlb'));
    const createDeps = options.createDeps ?? true;

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    // rpc/handle require a consuming queue; broadcast/event route via exchange(+routingKey).
    const consumesQueue = mode === 'rpc' || mode === 'handle';
    let queue = options.queue;
    if (consumesQueue && !queue) {
      queue = await askText(prompts, `Queue for '${name}'?`, name);
    }

    // Ensure the exchange first so a created queue never dangles.
    if (createDeps && !exchangeExists(doc, exchange)) {
      const exOutcome = ensureExchange(doc, { name: exchange });
      logOutcome(context, `exchange '${exchange}'`, exOutcome);
    }

    // Topic exchanges MUST carry a routingKey; default it to the topic name when unspecified.
    const routingKey = routingKeyRequired(doc, exchange) ? options.routingKey || name : options.routingKey;

    if (createDeps && queue && !queueExists(doc, queue)) {
      const qOutcome = ensureQueue(doc, {
        name: queue,
        exchange,
        // Match the topic's routingKey when the exchange is topic-typed (helper defaults to queue name otherwise).
        routingKey: routingKeyRequired(doc, exchange) ? routingKey || queue : options.routingKey,
      });
      logOutcome(context, `queue '${queue}'`, qOutcome);
    }

    // Only build a retry object when the caller supplied at least one retry field.
    const hasRetry =
      options.retryMaxAttempts !== undefined ||
      options.retryDelayMs !== undefined ||
      options.retryOnExhausted !== undefined;
    const retry: RetrySpec | undefined = hasRetry
      ? {
          maxAttempts: options.retryMaxAttempts,
          delayMs: options.retryDelayMs,
          onExhausted: options.retryOnExhausted,
        }
      : undefined;

    const outcome = ensureTopic(
      doc,
      {
        name,
        mode,
        queue,
        exchange,
        routingKey,
        errorBehavior: options.errorBehavior,
        retry,
        mandatory: options.mandatory,
        persistent: options.persistent,
        toObservable: options.toObservable,
      },
      { overwrite: options.overwrite },
    );
    logOutcome(context, `topic '${name}'`, outcome);

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
