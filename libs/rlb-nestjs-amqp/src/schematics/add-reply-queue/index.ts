import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { AddReplyQueueOptions } from './schema';

/**
 * `add-reply-queue` — idempotent set of a `broker.replyQueues[exchange] = queue` mapping,
 * comment-preserving. Unlike exchanges/queues/topics this section is a MAP (exchange → reply queue),
 * not a seq, so we go straight through the generic setIn helper, which reports created/updated/unchanged.
 */
export function main(options: AddReplyQueueOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.exchange !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const exchange = options.exchange || (await askText(prompts, 'Exchange?', ''));
    const queue = options.queue || (await askText(prompts, 'Reply queue name?', ''));
    if (!exchange || !queue) {
      context.logger.error('[rlb-amqp] add-reply-queue: both exchange and queue are required.');
      return tree;
    }

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    const outcome = setIn(doc, ['broker', 'replyQueues', exchange], queue);
    logOutcome(context, `reply queue for '${exchange}'`, outcome);

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
