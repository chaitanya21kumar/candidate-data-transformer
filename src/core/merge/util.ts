/** Shared helpers for the merge stage. */
import type { SourceRef } from '../types.js';

/** Stable, human-readable source identifier used in provenance ("ats_json:greenhouse.json"). */
export function sourceId(source: Pick<SourceRef, 'type' | 'name'>): string {
  return `${source.type}:${source.name}`;
}

/**
 * Fold a company name for comparison: lowercase, drop legal-suffix words, and remove all
 * non-alphanumerics so "Analytical Engines", "Analytical Engines Ltd" and
 * "AnalyticalEngines" all collapse to one key. Used for both name+company matching and
 * experience de-duplication.
 */
export function foldCompany(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pvt|private)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
