import { PathDefinition } from '../../proxy/config/path-definition.config';

/**
 * Segment kind ranking used to order routes so Express matches the most specific first:
 * static (0) before parametric `:x` (1) before wildcard `*` (2).
 */
function segmentKind(segment: string): number {
  if (segment.startsWith(':')) return 1;
  if (segment === '*' || segment.includes('*')) return 2;
  return 0;
}

function splitSegments(path: string): string[] {
  return (path || '').split('/').filter(Boolean);
}

/**
 * Comparator for two route paths. Compares segment by segment: at the first segment
 * whose kind differs, the lower kind (static < param < wildcard) wins; equal static
 * segments are ordered lexicographically; a shorter prefix sorts before a longer path.
 * Guarantees e.g. `/resources/path` is ordered before `/resources/:varName`.
 */
export function comparePaths(a: string, b: string): number {
  const sa = splitSegments(a);
  const sb = splitSegments(b);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    if (i >= sa.length) return -1;
    if (i >= sb.length) return 1;
    const ka = segmentKind(sa[i]);
    const kb = segmentKind(sb[i]);
    if (ka !== kb) return ka - kb;
    if (ka === 0 && sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1;
  }
  return 0;
}

/** Returns a new array of paths ordered static-before-parametric (stable for ties). */
export function orderPaths<T extends Pick<PathDefinition, 'path'>>(paths: T[]): T[] {
  return [...paths].sort((a, b) => comparePaths(a.path, b.path));
}
