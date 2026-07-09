import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { ensureQueue, ensureTopic } from '../utils/broker-yaml.util';
import { askNumber, askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { AddMetricsTopicOptions } from './schema';

/**
 * `add-metrics-topic` — move the gateway's per-request metrics off the shared rlb-gateway-admin
 * queue onto a dedicated, growth-bounded topic/queue (messageTtl + maxLength) and repoint
 * `gateway.metrics` at it. Idempotent + comment-preserving; the queue/topic upserts go through the
 * broker DATA helpers directly (no prompt ping-pong).
 */
export function main(options: AddMetricsTopicOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.topic !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const topic = options.topic || (await askText(prompts, 'Metrics topic name?', 'rlb-gateway-metrics'));
    const queue = options.queue || (await askText(prompts, 'Queue backing the topic?', topic));
    const exchange = options.exchange || (await askText(prompts, 'Exchange?', 'rlb'));
    const messageTtl = options.messageTtl ?? (await askNumber(prompts, 'Queue messageTtl (ms)?', 3600000));
    const maxLength = options.maxLength ?? (await askNumber(prompts, 'Queue maxLength?', 500000));
    const action = options.action || (await askText(prompts, 'Metrics action?', 'gw-metrics-track'));

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    const qOutcome = ensureQueue(
      doc,
      { name: queue, exchange, routingKey: queue, createQueueIfNotExists: true, durable: true, messageTtl, maxLength },
      { overwrite: options.overwrite },
    );
    logOutcome(context, `queue '${queue}'`, qOutcome);

    const tOutcome = ensureTopic(
      doc,
      { name: topic, mode: 'handle', queue, exchange, routingKey: queue },
      { overwrite: options.overwrite },
    );
    logOutcome(context, `topic '${topic}'`, tOutcome);

    const gOutcome = setIn(doc, ['gateway', 'metrics'], { topic, action });
    logOutcome(context, 'gateway.metrics', gOutcome);

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
