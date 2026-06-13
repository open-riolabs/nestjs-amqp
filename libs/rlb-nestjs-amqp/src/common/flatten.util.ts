/**
 * Flattens a nested plain object into dot-notation keys, suitable for a Mongo `$set`
 * partial update (so nested fields are merged, not replaced). Arrays, Buffers, Dates
 * and ObjectId-like values are treated as leaf values.
 */
export function flattenObject(input: Record<string, any>, prefix = '', out: Record<string, any> = {}): Record<string, any> {
  for (const key of Object.keys(input ?? {})) {
    const value = input[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flattenObject(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

function isPlainObject(value: any): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return false;
  // Mongo ObjectId / Buffer-backed ids and other class instances: treat as leaf.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
