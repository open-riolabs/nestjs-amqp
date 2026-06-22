/**
 * metaInfo (topic -> action -> { type, auth[], http[] }) -> route definitions (PathDefinition
 * shaped). ONE route per @BrokerHTTP entry, all forwarding to the same (topic, action). Auth is
 * PER ROUTE: the scanner has already resolved each @BrokerAuth onto its route (paired by name — see
 * pairAuthToRoutes), so `h.auth`/`allowAnonymous`/`actions` are read straight from the route (a route
 * with no paired auth is public). Kept loosely typed.
 */
export function buildPathDefinitionsFromMeta(meta: any): any[] {
  const out: any[] = [];
  for (const topic of Object.keys(meta || {})) {
    for (const action of Object.keys(meta[topic] || {})) {
      const entry = meta[topic][action] || {};
      for (const h of entry.http || []) {
        out.push({
          name: h.name ?? `${topic}:${action}:${h.method}:${h.path}`,
          method: h.method,
          path: h.path,
          dataSource: h.dataSource ?? 'body',
          topic,
          action,
          mode: h.mode ?? (entry.type === 'event' ? 'event' : 'rpc'),
          auth: h.auth,
          allowAnonymous: h.allowAnonymous,
          actions: h.actions ?? [],
          successStatusCode: h.successStatusCode,
          timeout: h.timeout,
          parseRaw: h.parseRaw,
          binary: h.binary,
          redirect: h.redirect,
          headers: h.headers ?? {},
          forwardHeaders: h.forwardHeaders ?? {},
        });
      }
    }
  }
  return out;
}

/**
 * Resolves PER-ROUTE auth: copies a paired @BrokerAuth's `authName`/`allowAnonymous`/`actions` ONTO
 * each @BrokerHTTP route entry (mutates them). Pairing rule, per method:
 *  - a SINGLE @BrokerHTTP auto-pairs the (first) @BrokerAuth — `httpName` not needed (simple case);
 *  - MULTIPLE @BrokerHTTP pair by `httpName` === route `name`.
 * Returns warning strings for auths that could not be paired (multiple routes + missing/unknown
 * `httpName`) so the caller can log them once at microservice startup. Pure (no deps) → unit-testable.
 */
export function pairAuthToRoutes(allHttp: any[], allAuth: any[], where = ''): string[] {
  const warnings: string[] = [];
  if (!allHttp?.length || !allAuth?.length) return warnings;
  const multiHttp = allHttp.length > 1;

  for (const h of allHttp) {
    const paired = multiHttp
      ? (h.name ? allAuth.find((a) => a.httpName === h.name) : undefined)
      : (allAuth.find((a) => !a.httpName) ?? allAuth[0]);
    if (paired) {
      h.auth = paired.authName;
      h.allowAnonymous = paired.allowAnonymous;
      h.actions = paired.actions;
    }
  }

  if (multiHttp) {
    const at = where ? ` on ${where}` : '';
    const names = new Set(allHttp.map((h) => h.name).filter(Boolean));
    const named = [...names].join(', ') || 'none';
    for (const a of allAuth) {
      if (!a.httpName) {
        warnings.push(`@BrokerAuth '${a.authName}'${at} has no 'httpName' but the method declares ${allHttp.length} @BrokerHTTP routes; auth NOT applied. Add httpName matching a @BrokerHTTP { name } (${named}).`);
      } else if (!names.has(a.httpName)) {
        warnings.push(`@BrokerAuth '${a.authName}'${at} references httpName '${a.httpName}' matching no @BrokerHTTP { name } (${named}); auth NOT applied.`);
      }
    }
  }
  return warnings;
}
