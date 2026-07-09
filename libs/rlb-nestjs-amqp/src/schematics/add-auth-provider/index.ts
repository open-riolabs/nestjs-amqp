import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { askSelect, askText, loadPrompts, logOutcome } from '../utils/schematic-prompt.util';
import { findConfigYaml, readConfigDoc, upsertSeqItemByKey, writeConfigDoc } from '../utils/yaml-config.util';
import { AddAuthProviderOptions, AuthProviderType } from './schema';

const TYPES: readonly AuthProviderType[] = ['jwt', 'jwks', 'basic', 'str-compare', 'none'];

/**
 * Optional fields that make sense per verification strategy. A field is only emitted when it is BOTH
 * relevant to the chosen type AND provided — so a `basic` provider never carries a stray `jwksUri`,
 * and a token provider never carries `clientSecret`. `name`/`type`/`headerPrefix` are always written.
 */
const RELEVANT_FIELDS: Record<AuthProviderType, readonly string[]> = {
  jwt: ['issuer', 'algorithms', 'secret', 'audience', 'uidClaim', 'jwtMap'],
  jwks: ['issuer', 'jwksUri', 'algorithms', 'audience', 'uidClaim', 'jwtMap', 'httpsAllowUnauthorized'],
  basic: ['clientId', 'clientSecret', 'uidClaim'],
  'str-compare': ['secret', 'uidClaim'],
  none: [],
};

/**
 * `add-auth-provider <name>` — idempotent upsert of a top-level `auth-providers[]` entry,
 * comment-preserving. The provider name is what gateway paths/events reference via `auth`.
 * Only the fields relevant to the selected verification `type` are written (see RELEVANT_FIELDS).
 */
export function main(options: AddAuthProviderOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const flagsProvided = options.name !== undefined;
    const prompts = loadPrompts(context, flagsProvided);

    const name = options.name || (await askText(prompts, 'Auth-provider name?', ''));
    if (!name) {
      context.logger.error('[rlb-amqp] add-auth-provider: a name is required.');
      return tree;
    }

    const type = (options.type as AuthProviderType) || (await askSelect(prompts, 'Provider type?', TYPES, 'jwks'));
    const headerPrefix = options.headerPrefix ?? 'X-GTW-AUTH-';

    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    // All candidate optional values; the per-type filter below keeps only the relevant, defined ones.
    const candidates: Record<string, unknown> = {
      uidClaim: options.uidClaim,
      jwtMap: options.jwtMap,
      algorithms: options.algorithms,
      issuer: options.issuer,
      jwksUri: options.jwksUri,
      secret: options.secret,
      audience: options.audience,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      httpsAllowUnauthorized: options.httpsAllowUnauthorized,
    };

    const item: Record<string, unknown> = { name, type, headerPrefix };
    for (const field of RELEVANT_FIELDS[type]) {
      if (candidates[field] !== undefined) item[field] = candidates[field];
    }

    // Fails-closed invariants for token providers: without these the gateway can't safely verify.
    if (type === 'jwt' || type === 'jwks') {
      if (!options.algorithms || options.algorithms.length === 0) {
        context.logger.warn(
          '[rlb-amqp] add-auth-provider: algorithms is REQUIRED for jwt/jwks — verification will be DENIED until set (algorithm-confusion guard).',
        );
      }
      if (!options.jwtMap || options.jwtMap.length === 0) {
        context.logger.warn(
          '[rlb-amqp] add-auth-provider: without jwtMap no identity claims are forwarded (uidClaim still needed for the action gate).',
        );
      }
    }

    const outcome = upsertSeqItemByKey(doc, ['auth-providers'], 'name', item, { overwrite: options.overwrite });
    logOutcome(context, `auth-provider '${name}'`, outcome);

    writeConfigDoc(tree, configPath, doc);
    return tree;
  };
}
