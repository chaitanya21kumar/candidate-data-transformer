/**
 * Small shared helpers for adapters: building a fully-formed {@link ExtractedField}
 * (with its base confidence already computed) and splitting multi-value cells.
 */
import { baseConfidence } from '../confidence.js';
import type { ExtractedField, ExtractionMethod, FieldPath, SourceRef } from '../types.js';

export function makeField(args: {
  recordId: string;
  source: SourceRef;
  path: FieldPath;
  value: unknown;
  method: ExtractionMethod;
  raw?: string;
}): ExtractedField {
  const base: ExtractedField = {
    recordId: args.recordId,
    source: args.source,
    path: args.path,
    value: args.value,
    method: args.method,
    confidence: baseConfidence(args.source.type, args.method),
  };
  return args.raw === undefined ? base : { ...base, raw: args.raw };
}

/** Split a cell that may hold several values ("a@x.com, b@y.com" / "Go; Rust"). */
export function splitList(value: string, opts?: { bullets?: boolean }): string[] {
  let separators = /[,;\n|]+/;
  if (opts?.bullets) separators = /[,;\n|•·]+/;
  return value
    .split(separators)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Strip a leading UTF-8 byte-order mark. Exported CSV/JSON files often carry one, and
 *  `JSON.parse` throws on it — so we remove it before parsing. */
export function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/** True for strings that carry no real signal ("", "n/a", "null", "-", "unknown"). */
export function isBlank(value: unknown): boolean {
  if (typeof value !== 'string') return value === null || value === undefined;
  const v = value.trim().toLowerCase();
  return v === '' || v === 'n/a' || v === 'na' || v === 'null' || v === '-' || v === 'unknown';
}
