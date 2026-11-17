import { resolveRateLimitConfig, validateRouteRateLimit } from './rate-limit';

describe('resolveRateLimitConfig', () => {
  it('is off when the block is absent or enabled: false', () => {
    expect(resolveRateLimitConfig(undefined)).toBeNull();
    expect(resolveRateLimitConfig(null)).toBeNull();
    expect(resolveRateLimitConfig({ enabled: false, default: { requestsPerSecond: 5 } })).toBeNull();
  });

  it('enabled: false still validates the block, so turning it back on cannot break the boot', () => {
    expect(() => resolveRateLimitConfig({ enabled: false, default: { requestsPerSecond: -1 } })).toThrow(/requestsPerSecond/);
  });

  it('default only: every route gets it, burst = rate rounded up (at least 1) when not set', () => {
    const rl = resolveRateLimitConfig({ default: { requestsPerSecond: 2.5 } });
    expect(rl.ruleFor('GET', '/anything')).toEqual({ requestsPerSecond: 2.5, burst: 3, source: 'default' });
    expect(resolveRateLimitConfig({ default: { requestsPerSecond: 0.2 } }).ruleFor('GET', '/x').burst).toBe(1);
    expect(rl.defaultRule).toEqual({ requestsPerSecond: 2.5, burst: 3, source: 'default' });
  });

  it('routes only: unlisted routes are not limited', () => {
    const rl = resolveRateLimitConfig({ routes: [{ path: '/a', requestsPerSecond: 1, burst: 5 }] });
    expect(rl.ruleFor('GET', '/a')).toEqual({ requestsPerSecond: 1, burst: 5, source: 'route' });
    expect(rl.ruleFor('POST', '/a')).toEqual({ requestsPerSecond: 1, burst: 5, source: 'route' }); // no method ⇒ every method
    expect(rl.ruleFor('GET', '/b')).toBeNull();
    expect(rl.defaultRule).toBeNull();
  });

  it('a rule with a method wins over the one without; the method matches in any case', () => {
    const rl = resolveRateLimitConfig({
      routes: [
        { path: '/a', requestsPerSecond: 10 },
        { path: '/a', method: 'post', requestsPerSecond: 1 },
      ],
    });
    expect(rl.ruleFor('POST', '/a').requestsPerSecond).toBe(1);
    expect(rl.ruleFor('get', '/a').requestsPerSecond).toBe(10);
  });

  it('a route inherits what it does not set: the default rate and burst, but not the burst when it sets its own rate', () => {
    const rl = resolveRateLimitConfig({
      default: { requestsPerSecond: 20, burst: 40 },
      routes: [
        { path: '/own-rate', requestsPerSecond: 1 },
        { path: '/own-burst', burst: 3 },
        { path: '/both', requestsPerSecond: 2, burst: 6 },
      ],
    });
    expect(rl.ruleFor('GET', '/own-rate')).toEqual({ requestsPerSecond: 1, burst: 1, source: 'route' });
    expect(rl.ruleFor('GET', '/own-burst')).toEqual({ requestsPerSecond: 20, burst: 3, source: 'route' });
    expect(rl.ruleFor('GET', '/both')).toEqual({ requestsPerSecond: 2, burst: 6, source: 'route' });
    expect(rl.ruleFor('GET', '/other')).toEqual({ requestsPerSecond: 20, burst: 40, source: 'default' });
  });

  it('enabled: false or requestsPerSecond: 0 on a route takes it out of the default', () => {
    const rl = resolveRateLimitConfig({
      default: { requestsPerSecond: 20 },
      routes: [{ path: '/health', enabled: false }, { path: '/upload', requestsPerSecond: 0 }],
    });
    expect(rl.ruleFor('GET', '/health')).toBeNull();
    expect(rl.ruleFor('POST', '/upload')).toBeNull();
  });

  it('a trailing slash does not matter, route parameters are compared as declared', () => {
    const rl = resolveRateLimitConfig({ routes: [{ path: '/bookings/:id/', requestsPerSecond: 1 }] });
    expect(rl.ruleFor('GET', '/bookings/:id')).not.toBeNull();
    expect(rl.ruleFor('GET', '/bookings/:id/')).not.toBeNull();
    expect(rl.ruleFor('GET', '/bookings/:bookingId')).toBeNull();
    expect(rl.routeRules).toEqual([{ method: undefined, path: '/bookings/:id' }]);
  });

  it('ipHeader is lower-cased, maxKeys defaults to 100000', () => {
    const rl = resolveRateLimitConfig({ ipHeader: ' CF-Connecting-IP ', default: { requestsPerSecond: 1 } });
    expect(rl.ipHeader).toBe('cf-connecting-ip');
    expect(rl.maxKeys).toBe(100000);
    expect(resolveRateLimitConfig({ maxKeys: 10, default: { requestsPerSecond: 1 } }).maxKeys).toBe(10);
  });

  it.each([
    ['not an object', 'yes', /must be an object/],
    ['unknown top key', { defaults: { requestsPerSecond: 1 } }, /unknown key 'defaults'/],
    ['enabled not boolean', { enabled: 'true' }, /enabled must be true or false/],
    ['negative rate', { default: { requestsPerSecond: -1 } }, /requestsPerSecond must be a number/],
    ['rate as a string', { default: { requestsPerSecond: '5' } }, /requestsPerSecond must be a number/],
    ['fractional burst', { default: { requestsPerSecond: 1, burst: 1.5 } }, /burst must be an integer/],
    ['zero burst', { default: { requestsPerSecond: 1, burst: 0 } }, /burst must be an integer/],
    ['unknown default key', { default: { rps: 1 } }, /unknown key 'rps'/],
    ['routes not a list', { routes: { path: '/a' } }, /routes must be a list/],
    ['route path without slash', { routes: [{ path: 'a', requestsPerSecond: 1 }] }, /must be the route path/],
    ['route without rate and no default', { routes: [{ path: '/a' }] }, /no requestsPerSecond and there is no rateLimit.default/],
    ['unknown route key', { routes: [{ path: '/a', requestsPerSecond: 1, limit: 3 }] }, /unknown key 'limit'/],
    ['duplicate route', { routes: [{ path: '/a', requestsPerSecond: 1 }, { path: '/a/', requestsPerSecond: 2 }] }, /declared twice/],
    ['empty ipHeader', { ipHeader: ' ' }, /ipHeader/],
    ['maxKeys zero', { maxKeys: 0 }, /maxKeys/],
  ])('stops the boot on %s', (_label, config, message) => {
    expect(() => resolveRateLimitConfig(config)).toThrow(message as RegExp);
  });

  it('a route disabled with enabled: false needs no rate', () => {
    expect(() => resolveRateLimitConfig({ routes: [{ path: '/a', enabled: false }] })).not.toThrow();
  });
});

describe('ruleFor — the route\'s own rateLimit field (YAML paths[], admin API, DB)', () => {
  it('works on an empty block (the gateway resolves an absent block as {}): only routes with their own rule are limited', () => {
    const rl = resolveRateLimitConfig({});
    expect(rl.ruleFor('GET', '/a', { requestsPerSecond: 2 })).toEqual({ requestsPerSecond: 2, burst: 2, source: 'path' });
    expect(rl.ruleFor('GET', '/a')).toBeNull();
    expect(rl.ruleFor('GET', '/a', null)).toBeNull();
  });

  it('wins over the rateLimit.routes entry for the same route', () => {
    const rl = resolveRateLimitConfig({ routes: [{ path: '/a', method: 'GET', requestsPerSecond: 1, burst: 1 }] });
    expect(rl.ruleFor('GET', '/a', { requestsPerSecond: 10, burst: 20 })).toEqual({ requestsPerSecond: 10, burst: 20, source: 'path' });
    expect(rl.ruleFor('GET', '/a', null)).toEqual({ requestsPerSecond: 1, burst: 1, source: 'route' });
  });

  it('inherits from the default like a routes entry: rate and burst, but not the burst when it sets its own rate', () => {
    const rl = resolveRateLimitConfig({ default: { requestsPerSecond: 4, burst: 40 } });
    expect(rl.ruleFor('GET', '/a', { burst: 8 })).toEqual({ requestsPerSecond: 4, burst: 8, source: 'path' });
    expect(rl.ruleFor('GET', '/a', { requestsPerSecond: 1.5 })).toEqual({ requestsPerSecond: 1.5, burst: 2, source: 'path' });
  });

  it('enabled: false or requestsPerSecond: 0 exempts the route from the default and from its routes entry', () => {
    const rl = resolveRateLimitConfig({ default: { requestsPerSecond: 4 }, routes: [{ path: '/a', requestsPerSecond: 1 }] });
    expect(rl.ruleFor('GET', '/a', { enabled: false })).toBeNull();
    expect(rl.ruleFor('GET', '/a', { requestsPerSecond: 0 })).toBeNull();
  });

  it('throws on a rule without a rate when there is no default, and on a malformed rule', () => {
    const rl = resolveRateLimitConfig({});
    expect(() => rl.ruleFor('GET', '/a', { burst: 3 })).toThrow(/no gateway.rateLimit.default/);
    expect(() => rl.ruleFor('GET', '/a', { requestsPerSecond: -1 })).toThrow(/requestsPerSecond/);
    expect(rl.ruleFor('GET', '/a', { enabled: false })).toBeNull(); // nothing to inherit: fine
  });

  it('throws on an empty rule, which would put the default in place of a stricter routes entry', () => {
    const rl = resolveRateLimitConfig({ default: { requestsPerSecond: 10 }, routes: [{ path: '/login', requestsPerSecond: 0.2 }] });
    expect(() => rl.ruleFor('POST', '/login', {})).toThrow(/sets nothing/);
    expect(() => rl.ruleFor('POST', '/login', { enabled: true })).toThrow(/sets nothing/);
  });
});

describe('validateRouteRateLimit', () => {
  it('null / undefined = no own rule', () => {
    expect(validateRouteRateLimit(undefined)).toBeNull();
    expect(validateRouteRateLimit(null)).toBeNull();
  });

  it('accepts enabled, requestsPerSecond and burst, each optional', () => {
    const rule = { enabled: true, requestsPerSecond: 0.5, burst: 3 };
    expect(validateRouteRateLimit(rule)).toBe(rule);
    expect(validateRouteRateLimit({ burst: 5 })).toEqual({ burst: 5 });
    expect(validateRouteRateLimit({ enabled: false })).toEqual({ enabled: false });
  });

  it.each([
    ['an empty rule', {}, /sets nothing/],
    ['enabled: true alone', { enabled: true }, /sets nothing/],
    ['a non-object', 5, /must be an object/],
    ['a list', [{ requestsPerSecond: 1 }], /must be an object/],
    ['an unknown key (path belongs to rateLimit.routes only)', { path: '/a', requestsPerSecond: 1 }, /unknown key 'path'/],
    ['a negative rate', { requestsPerSecond: -1 }, /rateLimit.requestsPerSecond/],
    ['a string rate', { requestsPerSecond: '5' }, /rateLimit.requestsPerSecond/],
    ['a fractional burst', { requestsPerSecond: 1, burst: 1.5 }, /rateLimit.burst/],
    ['a non-boolean enabled', { enabled: 'no' }, /rateLimit.enabled/],
  ])('rejects %s', (_label, value, message) => {
    expect(() => validateRouteRateLimit(value)).toThrow(message as RegExp);
  });
});
