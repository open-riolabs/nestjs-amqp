***REMOVED***!/usr/bin/env node
/**
 * gateway-paths-to-http.js
 * -------------------------------------------------------------------------------------------------
 * Turn a gateway YAML's `gateway.paths[]` into HTTP calls that insert each route into the DB via the
 * gateway-admin `gw-path-create` endpoint (POST /admin/paths, body = the full StoredHttpPath).
 *
 * Each YAML path entry already IS a PathDefinition, so it is sent through almost verbatim (the
 * server fills in `routeKey`). Routes are de-duplicated by identity (METHOD + path) because the
 * create handler rejects a second route with the same method+path (409).
 *
 * USAGE
 *   node scripts/gateway-paths-to-http.js <config.yaml> [options]
 *
 * OPTIONS
 *   --base <url>          Gateway base URL (default http://localhost:3000). Used in output + --execute.
 *   --endpoint <path>     Create endpoint (default /admin/paths).
 *   --format http|curl|json   Output artifact format (default http). Ignored when --execute is set.
 *   --out <file>          Write the artifact here (default: stdout).
 *   --auth <value>        Value for the auth header sent with every call (e.g. "Bearer eyJ...").
 *   --auth-header <name>  Auth header name (default Authorization).
 *   --execute             Actually POST every route (needs Node >= 18 global fetch). Prints a summary.
 *   --include-disabled    Also emit routes that look disabled (enabled: false). Default: skip them.
 *
 * EXAMPLES
 *   node scripts/gateway-paths-to-http.js tfr.yaml --out insert-routes.http
 *   node scripts/gateway-paths-to-http.js tfr.yaml --format curl --base https://gw.example.com > insert.sh
 *   node scripts/gateway-paths-to-http.js tfr.yaml --execute --base https://gw.example.com --auth "Bearer $TOKEN"
 */
'use strict';

const fs = require('fs');
const path = require('path');

process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });

let yaml;
try { yaml = require('js-yaml'); }
catch { console.error("Missing dependency 'js-yaml'. Install it with:  npm i -D js-yaml"); process.exit(1); }

// ---- args -----------------------------------------------------------------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const flags = new Set(['execute', 'include-disabled']);
      if (flags.has(key)) a[key] = true;
      else a[key] = argv[++i];
    } else a._.push(t);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const yamlFile = args._[0] || 'tfr.yaml';
const base = (args.base || 'http://localhost:3000').replace(/\/+$/, '');
const endpoint = args.endpoint || '/admin/paths';
const format = args.format || 'http';
const authHeader = args['auth-header'] || 'Authorization';
const authValue = args.auth || '';

if (!fs.existsSync(yamlFile)) {
  console.error(`YAML not found: ${path.resolve(yamlFile)}`);
  process.exit(1);
}

// ---- load + extract paths -------------------------------------------------
const doc = yaml.load(fs.readFileSync(yamlFile, 'utf8')) || {};
const rawPaths = (doc.gateway && Array.isArray(doc.gateway.paths)) ? doc.gateway.paths : [];
if (rawPaths.length === 0) {
  console.error('No gateway.paths[] found in the YAML.');
  process.exit(1);
}

const routeKeyOf = (p) => `${String(p.method || '').toUpperCase()} ${p.path}`;

// De-dup by identity (method+path) — the create endpoint 409s on duplicates.
const seen = new Map();   // routeKey -> first path name
const duplicates = [];
const bodies = [];
for (const p of rawPaths) {
  if (!p || !p.path || !p.method) continue;
  if (!args['include-disabled'] && p.enabled === false) continue;
  const key = routeKeyOf(p);
  if (seen.has(key)) { duplicates.push({ key, name: p.name, firstName: seen.get(key) }); continue; }
  seen.set(key, p.name);
  // Pass the path object through as the StoredHttpPath body (drop nothing the server understands).
  bodies.push(p);
}

if (duplicates.length) {
  process.stderr.write(`\n⚠ Skipped ${duplicates.length} duplicate route(s) (same METHOD + path):\n`);
  for (const d of duplicates) process.stderr.write(`   ${d.key}   ('${d.name}' duplicates '${d.firstName}')\n`);
  process.stderr.write('\n');
}

// ---- output builders ------------------------------------------------------
function buildHttp() {
  const out = [];
  out.push(`@base = ${base}`);
  out.push(`@auth = ${authValue}`);
  out.push(`***REMOVED*** ${bodies.length} routes → POST {{base}}${endpoint}  (gw-path-create)`);
  out.push('');
  for (const b of bodies) {
    out.push(`***REMOVED******REMOVED******REMOVED*** ${b.name || routeKeyOf(b)}  —  ${routeKeyOf(b)}`);
    out.push(`POST {{base}}${endpoint}`);
    out.push('Content-Type: application/json');
    if (authValue) out.push(`${authHeader}: {{auth}}`);
    out.push('');
    out.push(JSON.stringify(b, null, 2));
    out.push('');
  }
  return out.join('\n');
}

function buildCurl() {
  const out = ['***REMOVED***!/usr/bin/env bash', 'set -euo pipefail', `BASE="${base}"`, `AUTH="${authValue}"`, ''];
  for (const b of bodies) {
    const body = JSON.stringify(b).replace(/'/g, `'\\''`);
    const authArg = authValue ? ` -H "${authHeader}: $AUTH"` : '';
    out.push(`***REMOVED*** ${b.name || ''}  ${routeKeyOf(b)}`);
    out.push(`curl -sS -X POST "$BASE${endpoint}" -H "Content-Type: application/json"${authArg} -d '${body}'`);
    out.push('');
  }
  return out.join('\n');
}

function buildJson() {
  // NDJSON — one StoredHttpPath body per line.
  return bodies.map((b) => JSON.stringify(b)).join('\n') + '\n';
}

// ---- execute --------------------------------------------------------------
async function execute() {
  if (typeof fetch !== 'function') {
    console.error('--execute needs Node >= 18 (global fetch). Use --format curl/http instead.');
    process.exit(1);
  }
  let created = 0, conflict = 0, failed = 0;
  for (const b of bodies) {
    const headers = { 'Content-Type': 'application/json' };
    if (authValue) headers[authHeader] = authValue;
    try {
      const res = await fetch(`${base}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(b) });
      if (res.status === 409) { conflict++; console.log(`= 409 ${routeKeyOf(b)} (already exists)`); }
      else if (res.ok) { created++; console.log(`✓ ${res.status} ${routeKeyOf(b)}`); }
      else { failed++; console.log(`✗ ${res.status} ${routeKeyOf(b)} — ${(await res.text()).slice(0, 160)}`); }
    } catch (e) { failed++; console.log(`✗ ERR ${routeKeyOf(b)} — ${e.message}`); }
  }
  console.log(`\nDone: ${created} created, ${conflict} already existed, ${failed} failed (of ${bodies.length}).`);
  if (failed) process.exit(1);
}

// ---- run ------------------------------------------------------------------
if (args.execute) {
  execute();
} else {
  const artifact = format === 'curl' ? buildCurl() : format === 'json' ? buildJson() : buildHttp();
  if (args.out) {
    fs.writeFileSync(args.out, artifact);
    console.error(`Wrote ${bodies.length} routes → ${path.resolve(args.out)} (${format})`);
  } else {
    process.stdout.write(artifact);
  }
}
