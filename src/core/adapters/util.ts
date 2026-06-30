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

/** True for strings that carry no real signal ("", "n/a", "null", "-", "unknown"). */
export function isBlank(value: unknown): boolean {
  if (typeof value !== 'string') return value === null || value === undefined;
  const v = value.trim().toLowerCase();
  return v === '' || v === 'n/a' || v === 'na' || v === 'null' || v === '-' || v === 'unknown';
}
