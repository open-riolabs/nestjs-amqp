import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { askSelect, askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, upsertSeqItemByKey, writeConfigDoc } from '../utils/yaml-config.util';
import { AddRouteOptions, RouteDataSource, RouteMethod, RouteMode } from './schema';

const METHODS: readonly RouteMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const MODES: readonly RouteMode[] = ['rpc', 'event'];

/**
 * `add-route <name>` — idempotent upsert of a `gateway.paths[]` entry, comment-preserving.
 * Maps an HTTP method+path onto a broker topic/action. Only defined fields are written, so a route
 * stays as terse as the sample configs. `dataSource` defaults to the natural source for the method.
 */
export function main(options: AddRouteOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.name !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const name = options.name || (await askText(prompts, 'Route name?', ''));
    if (!name) {
      context.logger.error('[rlb-amqp] add-route: a name is required.');
      return tree;
    }

    const method = (options.method as RouteMethod) || (await askSelect(prompts, 'HTTP method?', METHODS, 'GET'));
    const path = options.path || (await askText(prompts, 'URL path?', ''));
    const topic = options.topic || (await askText(prompts, 'Topic?', ''));
    const action = options.action || (await askText(prompts, 'Action?', ''));
    const mode = (options.mode as RouteMode) || (await askSelect(prompts, 'Mode?', MODES, 'rpc'));
    // GET has no body, so read from the query string; everything else defaults to the JSON body.
    const dataSource: RouteDataSource = options.dataSource || (method === 'GET' ? 'query' : 'body');

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    const item: Record<string, unknown> = {
      name,
      method,
      path,
      dataSource,
      topic,
      action,
      mode,
      timeout: options.timeout,
      auth: options.auth,
      allowAnonymous: options.allowAnonymous,
      actions: options.actions,
      successStatusCode: options.successStatusCode,
      binary: options.binary,
      redirect: options.redirect,
      parseRaw: options.parseRaw,
    };

    // The ACL gate fails closed: actions with no auth means no userId to check → every request 403s.
    const hasActions = options.actions !== undefined && (!Array.isArray(options.actions) || options.actions.length > 0);
    if (hasActions && !options.auth && !options.allowAnonymous) {
      context.logger.warn(
        '[rlb-amqp] add-route: actions require auth on the same route (fails closed → every request 403).',
      );
    }
    if (options.parseRaw) {
      context.logger.warn(
        '[rlb-amqp] add-route: parseRaw needs rawBody:true at bootstrap (NestFactory.create({rawBody:true})).',
      );
    }

    const outcome = upsertSeqItemByKey(doc, ['gateway', 'paths'], 'name', item, { overwrite: options.overwrite });
    logOutcome(context, `route '${name}'`, outcome);

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
