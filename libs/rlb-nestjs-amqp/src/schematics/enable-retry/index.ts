import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { ensureExchange, ExchangeType, RetrySpec } from '../utils/broker-yaml.util';
import { askNumber, askSelect, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, findSeqItemByKey, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { EnableRetryOptions } from './schema';

/**
 * `enable-retry` — configure the 2.1.x bounded retry policy that replaces the old infinite-requeue
 * behaviour (built-in default is 5 attempts → drop). Its real value-add is DECLARING the dead-letter
 * exchange in broker.exchanges automatically, since retry.deadLetter.exchange must resolve to a real
 * declared exchange. Writes to broker.retry (broker-wide default) or topics[<name>].retry.
 */
export function main(options: EnableRetryOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.scope !== undefined || options.maxAttempts !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const scope = options.scope || (await askSelect(prompts, 'Retry scope?', ['broker', 'topic'] as const, 'broker'));
    const maxAttempts = options.maxAttempts ?? (await askNumber(prompts, 'Max attempts?', 5)) ?? 5;
    const delayMs = options.delayMs ?? (await askNumber(prompts, 'Delay between attempts (ms)?', 0)) ?? 0;

    // onExhausted defaults to dead-letter only when a DLX is actually configured, else drop.
    const dlx = options.deadLetterExchange;
    const onExhausted = options.onExhausted ?? (dlx ? 'dead-letter' : 'drop');

    const retry: RetrySpec = { maxAttempts, delayMs, onExhausted };
    if (dlx) {
      retry.deadLetter = { exchange: dlx, ...(options.deadLetterRoutingKey ? { routingKey: options.deadLetterRoutingKey } : {}) };
    }

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    // Declare the DLX so retry.deadLetter points at a real exchange (the schematic's main value).
    if (onExhausted === 'dead-letter' && dlx && (options.declareDlx ?? true)) {
      const dlxOutcome = ensureExchange(doc, { name: dlx, type: (options.dlxType as ExchangeType) ?? 'topic' });
      logOutcome(context, `dead-letter exchange '${dlx}'`, dlxOutcome);
    }

    if (scope === 'broker') {
      const outcome = setIn(doc, ['broker', 'retry'], retry);
      logOutcome(context, 'broker.retry', outcome);
    } else {
      const topic = options.topic;
      if (!topic) {
        context.logger.error('[rlb-amqp] enable-retry: --topic is required when scope=topic.');
        return tree;
      }
      const item = findSeqItemByKey(doc, ['topics'], 'name', topic);
      if (!item) {
        context.logger.warn(`[rlb-amqp] enable-retry: topic ${topic} not found in topics[]`);
      } else {
        item.set('retry', doc.createNode(retry));
        logOutcome(context, `topics[${topic}].retry`, 'updated');
      }
    }

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
