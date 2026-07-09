import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { askSelect, askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, upsertSeqItemByKey, writeConfigDoc } from '../utils/yaml-config.util';
import { AddWsEventOptions, WsEventType } from './schema';

const TYPES: readonly WsEventType[] = ['ws', 'http'];

/**
 * `add-ws-event <name>` — idempotent upsert of a `gateway.events[]` entry, comment-preserving.
 * A `ws` event pushes broker messages to subscribed clients (exchange/routingKey + auth/scoping);
 * an `http` event fans a broker message out to a webhook (url/method/timeout). Only the fields that
 * apply to the chosen `type` are written, and `httpMethod` maps onto WebSocketEvent's `method`.
 */
export function main(options: AddWsEventOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.name !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const name = options.name || (await askText(prompts, 'Event name?', ''));
    if (!name) {
      context.logger.error('[rlb-amqp] add-ws-event: a name is required.');
      return tree;
    }

    const type = (options.type as WsEventType) || (await askSelect(prompts, 'Event type?', TYPES, 'ws'));

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    // http events talk to a webhook (url/method/timeout); ws events push to subscribers with the
    // full auth/scoping surface. Building type-specific items keeps stray fields out of the config.
    const item: Record<string, unknown> =
      type === 'http'
        ? {
            name,
            type,
            url: options.url,
            method: options.httpMethod,
            timeout: options.timeout,
          }
        : {
            name,
            type,
            exchange: options.exchange,
            routingKey: options.routingKey,
            auth: options.auth,
            requireAuth: options.requireAuth,
            actions: options.actions,
            scopeClaim: options.scopeClaim,
            payloadKey: options.payloadKey,
          };

    // Per-user scoping needs BOTH halves: scopeClaim (the client's value) and payloadKey (the message
    // field to compare it to). With only scopeClaim, the compare has nothing to match → nothing ships.
    if (options.scopeClaim && !options.payloadKey) {
      context.logger.warn(
        '[rlb-amqp] add-ws-event: scopeClaim without payloadKey denies every message (per-user isolation needs both).',
      );
    }
    const hasActions = options.actions !== undefined && (!Array.isArray(options.actions) || options.actions.length > 0);
    if (hasActions && !options.auth) {
      context.logger.warn('[rlb-amqp] add-ws-event: actions require auth.');
    }

    const outcome = upsertSeqItemByKey(doc, ['gateway', 'events'], 'name', item, { overwrite: options.overwrite });
    logOutcome(context, `ws-event '${name}'`, outcome);

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
