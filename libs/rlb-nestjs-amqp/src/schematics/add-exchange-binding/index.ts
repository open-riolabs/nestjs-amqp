import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { isMap, YAMLMap } from 'yaml';
import { askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { ensureSeqAt, findConfigYaml, readConfigDoc, UpsertOutcome, writeConfigDoc } from '../utils/yaml-config.util';
import { AddExchangeBindingOptions } from './schema';

const BINDINGS = ['broker', 'exchangeBindings'];

/**
 * `add-exchange-binding` — idempotent upsert of a `broker.exchangeBindings[]` entry, comment-preserving.
 * Unlike exchanges/queues/topics there is no single `name` key, so identity is the (source, destination,
 * pattern) triple. We scan the seq for a matching item ourselves rather than reusing upsertSeqItemByKey.
 */
export function main(options: AddExchangeBindingOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.source !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const source = options.source || (await askText(prompts, 'Source exchange?', ''));
    const destination = options.destination || (await askText(prompts, 'Destination exchange?', ''));
    if (!source || !destination) {
      context.logger.error('[rlb-amqp] add-exchange-binding: source and destination are required.');
      return tree;
    }
    const pattern = options.pattern ?? (await askText(prompts, 'Binding pattern (routing key)?', ''));

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    const item: Record<string, unknown> = { source, destination, pattern };
    if (options.args !== undefined) item.args = options.args;

    const seq = ensureSeqAt(doc, BINDINGS);
    // Identity = source + destination + pattern (pattern discriminates fanout vs. topic bindings).
    const existing = seq.items.find(
      (it): it is YAMLMap =>
        isMap(it) &&
        String(it.get('source')) === String(source) &&
        String(it.get('destination')) === String(destination) &&
        String(it.get('pattern')) === String(pattern),
    );

    let outcome: UpsertOutcome;
    if (!existing) {
      const node = doc.createNode(item) as YAMLMap;
      // Keep the container block-styled even if it was seeded as an empty flow seq (`exchangeBindings: []`).
      seq.flow = false;
      node.flow = false;
      seq.add(node);
      outcome = 'created';
    } else if (options.overwrite) {
      const before = existing.toString();
      for (const [k, v] of Object.entries(item)) existing.set(k, doc.createNode(v));
      outcome = existing.toString() === before ? 'unchanged' : 'updated';
    } else {
      outcome = 'unchanged';
    }
    logOutcome(context, `exchange binding '${source}' → '${destination}'`, outcome);

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
