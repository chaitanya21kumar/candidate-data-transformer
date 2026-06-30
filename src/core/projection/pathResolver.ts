/**
 * Resolve a canonical "from" path against a profile object.
 *
 * Supported grammar (covers the assignment's examples and more):
 *   - dotted access:        "location.country"
 *   - array index:          "emails[0]", "experience[1].company"
 *   - array map (fan-out):   "skills[].name"   -> ["JavaScript", "Python", …]
 *
 * Returns the resolved value plus the concrete leaf path(s) it came from. Those leaf
 * paths let the projection layer attach the right confidence and provenance to each
 * projected field. A path that does not resolve yields `value: undefined`.
 */

interface Segment {
  key: string;
  index?: number; // [n]
  map?: boolean; // []
}

export interface ResolveResult {
  value: unknown;
  /** Concrete leaf path(s), e.g. ["emails[0]"] or ["skills[0].name", "skills[1].name"]. */
  paths: string[];
  /** True when a [] fan-out occurred, so `value` is an array. */
  hadMap: boolean;
}

const SEGMENT_RE = /^([A-Za-z_]\w*)(\[(\d+)\]|\[\])?$/;

function parse(expr: string): Segment[] | null {
  const segments: Segment[] = [];
  for (const part of expr.split('.')) {
    const m = part.match(SEGMENT_RE);
    if (!m || !m[1]) return null;
    const seg: Segment = { key: m[1] };
    if (m[2] === '[]') seg.map = true;
    else if (m[3] !== undefined) seg.index = Number(m[3]);
    segments.push(seg);
  }
  return segments;
}

export function resolvePath(root: unknown, expr: string): ResolveResult {
  const segments = parse(expr);
  if (!segments) return { value: undefined, paths: [expr], hadMap: false };

  let contexts: { value: unknown; path: string }[] = [{ value: root, path: '' }];
  let hadMap = false;

  for (const seg of segments) {
    const next: { value: unknown; path: string }[] = [];
    for (const ctx of contexts) {
      const container = ctx.value;
      const child = isObject(container) ? container[seg.key] : undefined;
      const basePath = ctx.path ? `${ctx.path}.${seg.key}` : seg.key;

      if (seg.index !== undefined) {
        const item = Array.isArray(child) ? child[seg.index] : undefined;
        next.push({ value: item, path: `${basePath}[${seg.index}]` });
      } else if (seg.map) {
        hadMap = true;
        if (Array.isArray(child)) child.forEach((item, i) => next.push({ value: item, path: `${basePath}[${i}]` }));
      } else {
        next.push({ value: child, path: basePath });
      }
    }
    contexts = next;
  }

  if (hadMap) {
    return { value: contexts.map((c) => c.value), paths: contexts.map((c) => c.path), hadMap };
  }
  const only = contexts[0];
  return { value: only?.value, paths: only ? [only.path] : [expr], hadMap };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
