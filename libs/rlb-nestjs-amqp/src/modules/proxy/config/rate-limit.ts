import { RateLimitConfig, RateLimitRouteRule, RateLimitRule, RouteRateLimit } from './path-definition.config';

/** A validated token bucket: `burst` back to back, refilled at `requestsPerSecond`. */
export interface ResolvedRateLimitRule {
  requestsPerSecond: number;
  burst: number;
  /** Where the rule comes from: the route's own `rateLimit` field ('path'), its entry in
   *  `rateLimit.routes` ('route'), or `rateLimit.default`. */
  source: 'path' | 'route' | 'default';
}

/** `gateway.rateLimit` after validation. */
export interface ResolvedRateLimit {
  /** Lower-case header the client IP is read from, or undefined for the socket address. */
  ipHeader?: string;
  maxKeys: number;
  /** `rateLimit.default` resolved (burst filled in), or null when only the listed routes are limited. */
  defaultRule: ResolvedRateLimitRule | null;
  /** The rules declared in `routes`, normalized — to warn about the ones no route matches. */
  routeRules: { method?: string; path: string; }[];
  /**
   * The bucket for a route, or null when the route is not limited. `own` is the route's own
   * `rateLimit` field: when set it wins over `routes` (missing values still come from `default`).
   * @throws Error when `own` is malformed, or sets no rate and there is no default to inherit it from.
   */
  ruleFor(method: string, path: string, own?: RouteRateLimit | null): ResolvedRateLimitRule | null;
}

export const DEFAULT_RATE_LIMIT_MAX_KEYS = 100_000;

const TOP_KEYS = ['enabled', 'default', 'routes', 'ipHeader', 'maxKeys'];
const RULE_KEYS = ['requestsPerSecond', 'burst'];
const OWN_KEYS = ['enabled', ...RULE_KEYS];
const ROUTE_KEYS = ['path', 'method', ...OWN_KEYS];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `/a/b/` and `/a/b` are the same route for Express (non-strict routing): compare them the same way. */
export const normalizeRoutePath = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') || '/' : path);

const defaultBurst = (requestsPerSecond: number) => Math.max(1, Math.ceil(requestsPerSecond));

function checkKeys(where: string, value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where}: unknown key '${key}' (allowed: ${allowed.join(', ')})`);
  }
}

function checkRate(where: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${where}.requestsPerSecond must be a number ≥ 0 (0 = no limit), got ${JSON.stringify(value)}`);
  }
  return value;
}

function checkBurst(where: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${where}.burst must be an integer ≥ 1, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Checks the fields a route rule shares with a route's own `rateLimit`: enabled, rate, burst. */
function checkRuleFields(where: string, r: Record<string, unknown>) {
  if (r.enabled !== undefined && typeof r.enabled !== 'boolean') throw new Error(`${where}.enabled must be true or false`);
  if (r.requestsPerSecond !== undefined) checkRate(where, r.requestsPerSecond);
  if (r.burst !== undefined) checkBurst(where, r.burst);
}

/**
 * Validates a route's own `rateLimit` field (YAML `paths[]`, admin API, DB row): an object with
 * `enabled`, `requestsPerSecond` and `burst`, all optional. Returns null when it is absent
 * (`undefined` / `null`). Whether a rule without a rate can inherit one is only known to the
 * gateway (it depends on `gateway.rateLimit.default`): see {@link ResolvedRateLimit.ruleFor}.
 * @throws Error naming the offending field (`where` prefixes it).
 */
export function validateRouteRateLimit(value: unknown, where = 'rateLimit'): RouteRateLimit | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) throw new Error(`${where} must be an object (or null to remove it)`);
  checkKeys(where, value, OWN_KEYS);
  checkRuleFields(where, value);
  return value as RouteRateLimit;
}

/**
 * Validates `gateway.rateLimit` and returns the resolver, or null when the limiter is off (block
 * absent or `enabled: false`). Strict like `gateway.aclContext`: a typo (unknown key, negative rate,
 * route without a rate and no default, duplicate route) stops the gateway at boot instead of
 * silently leaving a route unprotected.
 */
export function resolveRateLimitConfig(config: unknown): ResolvedRateLimit | null {
  if (config === undefined || config === null) return null;
  if (!isObject(config)) throw new Error('gateway.rateLimit must be an object');
  checkKeys('gateway.rateLimit', config, TOP_KEYS);
  const cfg = config as RateLimitConfig;

  if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
    throw new Error('gateway.rateLimit.enabled must be true or false');
  }

  let def: { requestsPerSecond: number; burst?: number; } | undefined;
  if (cfg.default !== undefined && cfg.default !== null) {
    if (!isObject(cfg.default)) throw new Error('gateway.rateLimit.default must be an object');
    checkKeys('gateway.rateLimit.default', cfg.default, RULE_KEYS);
    const d = cfg.default as RateLimitRule;
    def = { requestsPerSecond: checkRate('gateway.rateLimit.default', d.requestsPerSecond) };
    if (d.burst !== undefined) def.burst = checkBurst('gateway.rateLimit.default', d.burst);
  }

  if (cfg.ipHeader !== undefined && (typeof cfg.ipHeader !== 'string' || !cfg.ipHeader.trim())) {
    throw new Error('gateway.rateLimit.ipHeader must be a non-empty header name');
  }
  if (cfg.maxKeys !== undefined && (typeof cfg.maxKeys !== 'number' || !Number.isInteger(cfg.maxKeys) || cfg.maxKeys < 1)) {
    throw new Error('gateway.rateLimit.maxKeys must be an integer ≥ 1');
  }
  if (cfg.routes !== undefined && cfg.routes !== null && !Array.isArray(cfg.routes)) {
    throw new Error('gateway.rateLimit.routes must be a list');
  }

  // key: 'METHOD path' or '* path'
  const routes = new Map<string, RateLimitRouteRule & { path: string; }>();
  const routeRules: { method?: string; path: string; }[] = [];
  (cfg.routes || []).forEach((r, i) => {
    const where = `gateway.rateLimit.routes[${i}]`;
    if (!isObject(r)) throw new Error(`${where} must be an object`);
    checkKeys(where, r, ROUTE_KEYS);
    if (typeof r.path !== 'string' || !r.path.startsWith('/')) {
      throw new Error(`${where}.path must be the route path as declared, starting with '/', got ${JSON.stringify(r.path)}`);
    }
    if (r.method !== undefined && (typeof r.method !== 'string' || !r.method.trim())) {
      throw new Error(`${where}.method must be an HTTP method (omit it to match every method)`);
    }
    checkRuleFields(where, r);
    if (r.enabled !== false && r.requestsPerSecond === undefined && !def) {
      throw new Error(`${where} ('${r.path}') has no requestsPerSecond and there is no rateLimit.default to inherit it from`);
    }
    const path = normalizeRoutePath(r.path.trim());
    const method = r.method?.trim().toUpperCase();
    const key = `${method ?? '*'} ${path}`;
    if (routes.has(key)) throw new Error(`${where}: '${key}' is declared twice`);
    routes.set(key, { ...r, path, method });
    routeRules.push({ method, path });
  });

  if (cfg.enabled === false) return null;

  const defaultRule: ResolvedRateLimitRule | null = def?.requestsPerSecond
    ? { requestsPerSecond: def.requestsPerSecond, burst: def.burst ?? defaultBurst(def.requestsPerSecond), source: 'default' }
    : null;

  /** A route rule (own field or `routes` entry) on top of the default; null when it exempts the route. */
  const resolveRule = (rule: RouteRateLimit, source: 'path' | 'route'): ResolvedRateLimitRule | null => {
    if (rule.enabled === false) return null;
    const requestsPerSecond = rule.requestsPerSecond ?? def?.requestsPerSecond;
    if (requestsPerSecond === undefined) {
      throw new Error('rateLimit has no requestsPerSecond and there is no gateway.rateLimit.default to inherit it from');
    }
    if (!requestsPerSecond) return null;
    // A route that sets its own rate does not inherit the default's burst (it was sized for another rate).
    const burst = rule.burst ?? (rule.requestsPerSecond === undefined ? def?.burst : undefined) ?? defaultBurst(requestsPerSecond);
    return { requestsPerSecond, burst, source };
  };

  return {
    ipHeader: cfg.ipHeader?.trim().toLowerCase(),
    maxKeys: cfg.maxKeys ?? DEFAULT_RATE_LIMIT_MAX_KEYS,
    defaultRule,
    routeRules,
    ruleFor(method: string, path: string, own?: RouteRateLimit | null): ResolvedRateLimitRule | null {
      const ownRule = validateRouteRateLimit(own);
      if (ownRule) return resolveRule(ownRule, 'path');
      const p = normalizeRoutePath(path);
      const entry = routes.get(`${method.toUpperCase()} ${p}`) ?? routes.get(`* ${p}`);
      return entry ? resolveRule(entry, 'route') : defaultRule;
    },
  };
}
