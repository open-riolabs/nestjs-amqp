/**
 * metaInfo (topic -> action -> { type, auth[], http[] }) -> route definitions (PathDefinition
 * shaped). ONE route per @BrokerHTTP entry, all forwarding to the same (topic, action). Auth is
 * per-action (see the scanner), so `auth[0]` is THIS action's auth — flattened onto each route;
 * a per-route `@BrokerHTTP` option still overrides it. Kept loosely typed (no proxy dependency).
 */
export function buildPathDefinitionsFromMeta(meta: any): any[] {
  const out: any[] = [];
  for (const topic of Object.keys(meta || {})) {
    for (const action of Object.keys(meta[topic] || {})) {
      const entry = meta[topic][action] || {};
      const auth = Array.isArray(entry.auth) ? entry.auth[0] : undefined;
      for (const h of entry.http || []) {
        out.push({
          name: h.name ?? `${topic}:${action}:${h.method}:${h.path}`,
          method: h.method,
          path: h.path,
          dataSource: h.dataSource ?? 'body',
          topic,
          action,
          mode: h.mode ?? (entry.type === 'event' ? 'event' : 'rpc'),
          auth: h.auth ?? auth?.authName,
          allowAnonymous: h.allowAnonymous ?? auth?.allowAnonymous,
          roles: h.roles ?? auth?.roles ?? [],
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
