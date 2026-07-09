import { Tree } from '@angular-devkit/schematics';
import { Document, isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from 'yaml';

/**
 * Comment-preserving `config.yaml` editing shared by every YAML schematic.
 *
 * All edits go through the `yaml` (eemeli) CST/Document API so existing comments, key order and
 * formatting survive a round-trip — a plain `js-yaml` load/dump would strip them. The helpers are
 * deliberately data-only: prompting and the "create the missing dependency?" flow live in each
 * schematic's index.ts, so this module never triggers interactive I/O and stays easy to unit-test.
 */

export const DEFAULT_CONFIG_PATH = 'config/config.yaml';

/** Outcome of an idempotent upsert, surfaced to the user as a log line. */
export type UpsertOutcome = 'created' | 'updated' | 'unchanged';

/** Locate the project's config.yaml, preferring an explicit path, then the usual locations, then a scan. */
export function findConfigYaml(tree: Tree, preferred?: string): string {
  const candidates = [preferred, DEFAULT_CONFIG_PATH, 'src/config/config.yaml', 'config.yaml'].filter(
    (c): c is string => !!c,
  );
  for (const c of candidates) {
    if (tree.exists(c)) return c;
  }
  let found: string | undefined;
  tree.visit((p) => {
    if (!found && p.endsWith('/config.yaml')) found = p.replace(/^\//, '');
  });
  return found || preferred || DEFAULT_CONFIG_PATH;
}

/** Parse the config into a mutable Document (or a fresh empty one when the file does not exist yet). */
export function readConfigDoc(tree: Tree, path: string): { doc: Document; existed: boolean } {
  if (tree.exists(path)) {
    const raw = tree.read(path)!.toString('utf-8');
    return { doc: parseDocument(raw), existed: true };
  }
  return { doc: new Document({}), existed: false };
}

/** Serialize the Document back to the tree (create or overwrite). `lineWidth: 0` disables line wrapping. */
export function writeConfigDoc(tree: Tree, path: string, doc: Document): void {
  const out = doc.toString({ lineWidth: 0 });
  if (tree.exists(path)) tree.overwrite(path, out);
  else tree.create(path, out);
}

/** Ensure `path` resolves to a YAMLSeq, creating (and any missing parent maps) if needed. */
export function ensureSeqAt(doc: Document, path: (string | number)[]): YAMLSeq {
  const node = doc.getIn(path, true);
  if (isSeq(node)) return node;
  const seq = new YAMLSeq();
  doc.setIn(path, seq);
  return seq;
}

/** Ensure `path` resolves to a YAMLMap, creating (and any missing parent maps) if needed. */
export function ensureMapAt(doc: Document, path: (string | number)[]): YAMLMap {
  const node = doc.getIn(path, true);
  if (isMap(node)) return node;
  const map = new YAMLMap();
  doc.setIn(path, map);
  return map;
}

/** Find a map item in the seq at `path` whose `keyField` equals `key` (string-compared). */
export function findSeqItemByKey(
  doc: Document,
  path: (string | number)[],
  keyField: string,
  key: string,
): YAMLMap | undefined {
  const node = doc.getIn(path, true);
  if (!isSeq(node)) return undefined;
  return node.items.find((it): it is YAMLMap => isMap(it) && String(it.get(keyField)) === String(key));
}

/** True when a map keyed by `keyField === key` already exists in the seq at `path`. */
export function seqItemExists(doc: Document, path: (string | number)[], keyField: string, key: string): boolean {
  return !!findSeqItemByKey(doc, path, keyField, key);
}

export interface UpsertOptions {
  /** When the item already exists: merge `item`'s fields into it. Default false → leave it untouched. */
  overwrite?: boolean;
  /** A `# comment` attached above the newly created item (ignored when the item already exists). */
  commentBefore?: string;
}

/**
 * Idempotent upsert of `item` into the YAMLSeq at `path`, matched by `item[keyField]`.
 *  - missing → appended (block style), optional leading comment → 'created'
 *  - present & !overwrite → left as-is → 'unchanged'
 *  - present & overwrite → each field of `item` is set on the existing map → 'updated'/'unchanged'
 * `undefined` fields in `item` are skipped so callers can pass sparse specs.
 */
export function upsertSeqItemByKey(
  doc: Document,
  path: (string | number)[],
  keyField: string,
  item: Record<string, unknown>,
  opts: UpsertOptions = {},
): UpsertOutcome {
  const seq = ensureSeqAt(doc, path);
  const clean = stripUndefined(item);
  const existing = seq.items.find(
    (it): it is YAMLMap => isMap(it) && String(it.get(keyField)) === String(clean[keyField]),
  );

  if (!existing) {
    const node = doc.createNode(clean) as YAMLMap;
    if (opts.commentBefore) node.commentBefore = ` ${opts.commentBefore}`;
    // Normalize the container to block style: a config seeded with an empty flow seq (`topics: []`)
    // would otherwise render every appended item inline (`[ { name: ... } ]`). Block is the readable,
    // diff-friendly form the rest of the config uses.
    seq.flow = false;
    node.flow = false;
    seq.add(node);
    return 'created';
  }

  if (!opts.overwrite) return 'unchanged';

  const before = existing.toString();
  for (const [k, v] of Object.entries(clean)) {
    existing.set(k, doc.createNode(v));
  }
  return existing.toString() === before ? 'unchanged' : 'updated';
}

/** Set a scalar (or nested map/seq) at `path`, creating parents. Returns whether the value changed. */
export function setIn(doc: Document, path: (string | number)[], value: unknown): UpsertOutcome {
  const prev = doc.getIn(path, false);
  const existed = prev !== undefined;
  if (existed && JSON.stringify(prev) === JSON.stringify(value)) return 'unchanged';
  doc.setIn(path, doc.createNode(value));
  return existed ? 'updated' : 'created';
}

/** Delete the item keyed by `keyField === key` from the seq at `path`. Returns true when removed. */
export function deleteSeqItemByKey(
  doc: Document,
  path: (string | number)[],
  keyField: string,
  key: string,
): boolean {
  const node = doc.getIn(path, true);
  if (!isSeq(node)) return false;
  const idx = node.items.findIndex((it) => isMap(it) && String(it.get(keyField)) === String(key));
  if (idx === -1) return false;
  node.items.splice(idx, 1);
  return true;
}

/** Read a scalar value at `path` (JS value, not the wrapping node). */
export function getScalar(doc: Document, path: (string | number)[]): unknown {
  return doc.getIn(path, false);
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
