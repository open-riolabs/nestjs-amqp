#!/usr/bin/env node
/**
 * broker-http-decorators.js
 * -------------------------------------------------------------------------------------------------
 * Codemod to run INSIDE a microservice repo. For every method already decorated with
 * `@BrokerAction(topic, action)`, it looks up the matching route(s) in a gateway YAML (by
 * topic+action) and inserts the paired decorators right after the @BrokerAction:
 *
 *     @BrokerAction('booking', 'get-booking')
 *     @BrokerHTTP('GET', '/bookings/:id', 'params')          // single route → no name needed
 *     @BrokerAuth('riolabs-dev-jwks', true)
 *     async getBooking(...) { ... }
 *
 * When a method ends up with MULTIPLE routes, each @BrokerHTTP gets a `name` and the paired
 * @BrokerAuth references it via `httpName` (auth stays decoupled, paired per route):
 *
 *     @BrokerHTTP('GET', '/bookings/:id',       'params', { name: 'get-booking' })
 *     @BrokerAuth('riolabs-dev-jwks', true, undefined, 'get-booking')
 *     @BrokerHTTP('GET', '/admin/bookings/:id', 'params', { name: 'admin-get-booking' })
 *     @BrokerAuth('riolabs-admin-jwks', undefined, undefined, 'admin-get-booking')
 *
 * It adds `BrokerHTTP`/`BrokerAuth` to the `@open-rlb/nestjs-amqp` import. Methods whose
 * (topic, action) is not in the YAML are left untouched. Idempotent: a route whose path is already
 * present in a sibling @BrokerHTTP is skipped.
 *
 * USAGE
 *   node broker-http-decorators.js <gateway.yaml> [--src ./src] [--write] [--quote single|double]
 *
 *   (default is a DRY RUN — prints what it would change. Pass --write to apply.)
 *
 * NOTES
 *   - dataSource 'body-query' / 'query-body' are not expressible on @BrokerHTTP (only query|body|
 *     params); they are down-mapped (body-query→body, query-body→query) with an inline NOTE comment.
 *   - The route's rpc/event nature stays on @BrokerAction (3rd arg); this codemod never edits it,
 *     but warns when a YAML route is `mode: event` and the existing @BrokerAction has no 'event' type.
 */
'use strict';

const fs = require('fs');
const path = require('path');

process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });

let yaml;
try { yaml = require('js-yaml'); }
catch { console.error("Missing dependency 'js-yaml'. Install it with:  npm i -D js-yaml"); process.exit(1); }

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const t = argv[i];
  if (t === '--write') args.write = true;
  else if (t.startsWith('--')) args[t.slice(2)] = argv[++i];
  else args._.push(t);
}
const yamlFile = args._[0] || 'tfr.yaml';
const srcDir = args.src || 'src';
const q = args.quote === 'double' ? '"' : "'";

if (!fs.existsSync(yamlFile)) { console.error(`YAML not found: ${path.resolve(yamlFile)}`); process.exit(1); }
if (!fs.existsSync(srcDir)) { console.error(`Source dir not found: ${path.resolve(srcDir)}`); process.exit(1); }

// ---- index the YAML routes by topic::action -------------------------------
const doc = yaml.load(fs.readFileSync(yamlFile, 'utf8')) || {};
const paths = (doc.gateway && Array.isArray(doc.gateway.paths)) ? doc.gateway.paths : [];
const routesByKey = new Map();
for (const p of paths) {
  if (!p || !p.topic || !p.action || !p.path || !p.method) continue;
  const key = `${p.topic}::${p.action}`;
  if (!routesByKey.has(key)) routesByKey.set(key, []);
  routesByKey.get(key).push(p);
}

// ---- tiny TS scanning helpers --------------------------------------------
const isDecoratorStart = (line) => /^\s*@\w+/.test(line);
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

/** Span of a decorator starting at line `start` (balances parens across lines). */
function decoratorSpan(lines, start) {
  const name = (lines[start].match(/@(\w+)/) || [])[1] || '';
  const open = lines[start].indexOf('(', lines[start].indexOf('@'));
  if (open === -1) return { name, endIdx: start, text: lines[start] };
  let depth = 0, end = start;
  outer: for (let i = start; i < lines.length; i++) {
    const from = i === start ? open : 0;
    for (let c = from; c < lines[i].length; c++) {
      if (lines[i][c] === '(') depth++;
      else if (lines[i][c] === ')') { depth--; if (depth === 0) { end = i; break outer; } }
    }
  }
  return { name, endIdx: end, text: lines.slice(start, end + 1).join('\n') };
}

const reTwoStrings = /\(\s*(['"`])([^'"`]*)\1\s*,\s*(['"`])([^'"`]*)\3/;   // ('a', 'b'
const reHttpPath = /@BrokerHTTP\(\s*(['"`])[^'"`]*\1\s*,\s*(['"`])([^'"`]*)\2/; // 2nd arg = path

function mapDataSource(ds) {
  if (ds === 'body-query') return { ds: 'body', note: ds };
  if (ds === 'query-body') return { ds: 'query', note: ds };
  if (ds === 'query' || ds === 'body' || ds === 'params') return { ds, note: null };
  return { ds: 'body', note: ds || '(none)' };
}

function objLiteral(obj) {
  return JSON.stringify(obj).replace(/"(\w+)":/g, '$1:'); // unquote simple identifier keys
}

function buildHttp(route, { action, name, indent }) {
  const method = String(route.method).toUpperCase();
  const { ds, note } = mapDataSource(route.dataSource);
  const opts = {};
  if (name) opts.name = name;       // route name → lets a @BrokerAuth pair to THIS route (multi-route)
  if (action) opts.action = action; // disambiguate when the method declares multiple @BrokerAction
  for (const k of ['successStatusCode', 'timeout', 'parseRaw', 'binary', 'redirect', 'headers', 'forwardHeaders']) {
    if (route[k] !== undefined && route[k] !== null) opts[k] = route[k];
  }
  const tail = Object.keys(opts).length ? `, ${objLiteral(opts)}` : '';
  const dec = `${indent}@BrokerHTTP(${q}${method}${q}, ${q}${route.path}${q}, ${q}${ds}${q}${tail})`;
  return note ? `${indent}// NOTE: original dataSource '${note}' is not expressible on @BrokerHTTP; using '${ds}'\n${dec}` : dec;
}

// @BrokerAuth stays DECOUPLED. `httpName` pairs it to a @BrokerHTTP { name } (needed only when the
// method has multiple routes). Returns null for public routes (auth:false / no auth).
function buildAuth(route, httpName, indent) {
  if (!route.auth || route.auth === false) return null;
  const actions = Array.isArray(route.actions)
    ? (route.actions.length ? route.actions : null)
    : (route.actions ? [route.actions] : null);
  const parts = [`${q}${route.auth}${q}`];
  const needAnon = route.allowAnonymous !== undefined || actions || httpName;
  if (needAnon) parts.push(route.allowAnonymous === undefined ? 'undefined' : String(route.allowAnonymous));
  if (actions || httpName) parts.push(actions ? objLiteral(actions) : 'undefined');
  if (httpName) parts.push(`${q}${httpName}${q}`);
  return `${indent}@BrokerAuth(${parts.join(', ')})`;
}

// ---- process one file -----------------------------------------------------
function processFile(file) {
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.split('\n');
  const edits = [];        // { afterIdx, textLines: [] }
  let needHttp = false, needAuth = false, matched = 0, untouched = 0;
  const warnings = [];

  let i = 0;
  while (i < lines.length) {
    if (!isDecoratorStart(lines[i])) { i++; continue; }
    // collect a contiguous decorator block (decorators + interleaved comments, no blank lines)
    const decos = [];
    let j = i;
    while (j < lines.length && (isDecoratorStart(lines[j]) || isComment(lines[j]))) {
      if (isDecoratorStart(lines[j])) { const s = decoratorSpan(lines, j); decos.push({ ...s, startIdx: j }); j = s.endIdx + 1; }
      else j++;
    }
    const memberLine = j; // first non-decorator/non-comment line = the decorated member

    const brokerActions = decos.filter((d) => d.name === 'BrokerAction');
    if (brokerActions.length) {
      const actions = brokerActions.map((d) => { const m = d.text.match(reTwoStrings); return m ? { topic: m[2], action: m[4], endIdx: d.endIdx } : null; }).filter(Boolean);
      const existingPaths = new Set(decos.filter((d) => d.name === 'BrokerHTTP').map((d) => (d.text.match(reHttpPath) || [])[3]).filter(Boolean));
      const multi = actions.length > 1;
      const indent = (lines[brokerActions[0].startIdx].match(/^\s*/) || [''])[0];
      const lastActionEnd = Math.max(...actions.map((a) => a.endIdx));

      // Collect the routes to add across the method's actions FIRST, so we know whether the method
      // ends up with multiple @BrokerHTTP (then each route gets a name and auth pairs by httpName).
      const toAdd = []; // { route, action }
      for (const a of actions) {
        const routes = routesByKey.get(`${a.topic}::${a.action}`) || [];
        for (const r of routes) {
          if (existingPaths.has(r.path)) continue;
          toAdd.push({ route: r, action: a.action });
        }
        if (routes.length) matched++; else untouched++;
      }
      const multiRoute = toAdd.length > 1;

      // Assign a stable route name (yaml `name`, de-duped) only when the method has multiple routes.
      const used = new Set();
      for (const item of toAdd) {
        if (!multiRoute) continue;
        let nm = item.route.name || `${item.route.method}-${item.route.path}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
        const base = nm; let k = 2;
        while (used.has(nm)) nm = `${base}-${k++}`;
        used.add(nm);
        item.name = nm;
      }

      const textLines = [];
      for (const item of toAdd) {
        textLines.push(buildHttp(item.route, { action: multi ? item.action : null, name: item.name || null, indent }));
        const authLine = buildAuth(item.route, item.name || null, indent);
        if (authLine) { textLines.push(authLine); needAuth = true; }
        needHttp = true;
        if (item.route.mode === 'event') warnings.push(`event-mode route ${item.route.method} ${item.route.path} (${item.route.topic}/${item.action}) → ensure @BrokerAction(..., 'event')`);
      }
      if (multiRoute) {
        warnings.push(`multiple routes on one method [${toAdd.map((x) => x.route.method + ' ' + x.route.path).join(', ')}] → named for per-route @BrokerAuth pairing`);
      }
      if (toAdd.length) edits.push({ afterIdx: lastActionEnd, textLines });
    }
    i = memberLine + 1;
  }

  if (!edits.length) return { file, changed: false, added: 0, matched, untouched, warnings };

  // apply insertions bottom-to-top
  let out = lines.slice();
  for (const e of edits.sort((a, b) => b.afterIdx - a.afterIdx)) {
    out.splice(e.afterIdx + 1, 0, ...e.textLines);
  }
  let content = out.join('\n');

  // ensure the import carries BrokerHTTP / BrokerAuth
  content = content.replace(/import\s*\{([^}]*)\}\s*from\s*(['"])@open-rlb\/nestjs-amqp\2/, (full, inner, qq) => {
    const names = inner.split(',').map((s) => s.trim()).filter(Boolean);
    const set = new Set(names);
    if (needHttp) set.add('BrokerHTTP');
    if (needAuth) set.add('BrokerAuth');
    return `import { ${[...set].sort().join(', ')} } from ${qq}@open-rlb/nestjs-amqp${qq}`;
  });

  const added = edits.reduce((n, e) => n + e.textLines.filter((l) => /@Broker(HTTP|Auth)\(/.test(l)).length, 0);
  return { file, changed: content !== original, added, matched, untouched, warnings, content };
}

// ---- walk src -------------------------------------------------------------
function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!/node_modules|dist|\.git/.test(ent.name)) walk(full, acc); }
    else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.spec.ts')) acc.push(full);
  }
  return acc;
}

const files = walk(srcDir);
let totalAdded = 0, totalFiles = 0, totalMatched = 0;
const allWarnings = [];
for (const f of files) {
  const r = processFile(f);
  totalMatched += r.matched;
  for (const w of r.warnings) allWarnings.push(`${path.relative('.', f)}: ${w}`);
  if (!r.changed) continue;
  totalFiles++; totalAdded += r.added;
  const rel = path.relative('.', f);
  if (args.write) { fs.writeFileSync(f, r.content); console.log(`✓ ${rel} — +${r.added} decorator(s)`); }
  else console.log(`would update ${rel} — +${r.added} decorator(s)`);
}

console.log(`\n${args.write ? 'Updated' : 'Would update'} ${totalFiles} file(s), +${totalAdded} decorator(s). (${totalMatched} @BrokerAction matched a YAML route.)`);
if (allWarnings.length) { console.log('\n⚠ Warnings:'); for (const w of allWarnings) console.log('  ' + w); }
if (!args.write && totalFiles) console.log('\nDry run — re-run with --write to apply.');
