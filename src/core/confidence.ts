/**
 * The confidence model, in one place so it is easy to read and defend.
 *
 * A claim's confidence starts as `source trust x method trust`:
 *  - source trust  — how reliable the system is (a curated CSV beats free-text notes);
 *  - method trust  — how the value was obtained (a typed column beats a regex hit).
 *
 * When several independent sources agree on the same value, confidence rises via a
 * noisy-OR combination (corroboration). The overall profile confidence is a coverage-
 * weighted average of the identity-bearing fields. Every number here is deterministic.
 */
import type { ExtractionMethod, SourceType } from './types.js';

/** Base trust per source system, in [0, 1]. */
export const SOURCE_TRUST: Record<SourceType, number> = {
  csv: 0.9, // recruiter-curated structured rows
  ats_json: 0.88, // applicant-tracking export (typed, but mapped field names)
  github: 0.85, // authoritative for GitHub-native facts (name, bio, languages)
  linkedin: 0.8, // professional profile fields
  resume: 0.75, // parsed from prose
  notes: 0.55, // recruiter free text — useful but least reliable
};

/** Trust multiplier per extraction method, in [0, 1]. */
export const METHOD_TRUST: Record<ExtractionMethod, number> = {
  structured_field: 1.0,
  api_field: 0.97,
  labeled_field: 0.85,
  regex_extraction: 0.7,
  heuristic: 0.6,
};

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Round to 4 decimals so confidence is stable and byte-identical across runs. */
export function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Base confidence of a single extracted claim. */
export function baseConfidence(source: SourceType, method: ExtractionMethod): number {
  return round4(clamp01(SOURCE_TRUST[source] * METHOD_TRUST[method]));
}

/**
 * Combine independent confidences via noisy-OR: 1 - Pi(1 - c_i).
 * Two sources at 0.8 corroborate to 0.96 — agreement increases certainty, and the
 * result is monotonic and bounded in [0, 1].
 */
export function noisyOr(confidences: readonly number[]): number {
  if (confidences.length === 0) return 0;
  let product = 1;
  for (const c of confidences) product *= 1 - clamp01(c);
  return round4(clamp01(1 - product));
}

/**
 * Overall profile confidence: a weighted average of the identity-bearing fields that
 * are actually present. Weights reflect how much a field anchors a real person.
 * Missing fields simply do not contribute (so a sparse profile is not unfairly
 * penalized below what it does know, but breadth still raises the score).
 */
export const OVERALL_WEIGHTS: Record<string, number> = {
  full_name: 3,
  emails: 3,
  phones: 2,
  'location.country': 1,
  headline: 1,
  skills: 2,
  experience: 2,
  education: 1,
  links: 1,
};

export function overallConfidence(present: ReadonlyArray<{ weight: number; confidence: number }>): number {
  if (present.length === 0) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const { weight, confidence } of present) {
    weighted += weight * clamp01(confidence);
    totalWeight += weight;
  }
  return totalWeight === 0 ? 0 : round4(clamp01(weighted / totalWeight));
}
