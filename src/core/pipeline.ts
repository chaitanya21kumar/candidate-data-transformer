/**
 * End-to-end pipeline orchestration: detect/extract -> normalize -> resolve -> merge ->
 * (default schema | projection) -> validate.
 *
 * The whole flow is deterministic: stable ordering throughout, fixed source/method
 * priorities, and no timestamps or randomness in any output. Garbage input degrades to
 * empty contributions; only an internal invariant violation (a canonical profile that
 * fails its own schema) throws — which would signal a real bug, not bad input.
 */
import type { CanonicalProfile, RawSource, ResolvedProfile } from './types.js';
import { extractAll } from './adapters/index.js';
import { mergeToProfiles, type NormalizeOptions } from './merge/index.js';
import { canonicalProfileSchema } from './schema/canonical.js';
import { parseConfig, projectAll } from './projection/index.js';
import type { OutputConfig } from './schema/config.js';

export interface PipelineOptions extends NormalizeOptions {
  /** Optional runtime output config (object). When present, output is projected. */
  config?: unknown;
}

export interface DefaultResult {
  mode: 'default';
  count: number;
  profiles: CanonicalProfile[];
  diagnostics: string[];
}

export interface ProjectedResult {
  mode: 'projected';
  count: number;
  config: OutputConfig;
  records: Record<string, unknown>[];
  diagnostics: string[];
}

export type PipelineResult = DefaultResult | ProjectedResult;

/** Resolve raw sources into rich internal profiles (canonical + per-field confidence). */
export function resolveProfiles(sources: readonly RawSource[], opts: NormalizeOptions = {}): ResolvedProfile[] {
  return mergeToProfiles(extractAll(sources), opts);
}

/** Validate a canonical profile against its schema before returning it. */
export function validateDefault(profile: CanonicalProfile): CanonicalProfile {
  const result = canonicalProfileSchema.safeParse(profile);
  if (!result.success) {
    throw new Error(
      `Internal error: canonical profile ${profile.candidate_id} failed schema validation: ` +
        result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

export function transform(sources: readonly RawSource[], opts: PipelineOptions = {}): PipelineResult {
  const { config: rawConfig, ...normOpts } = opts;
  const resolved = resolveProfiles(sources, normOpts);
  const diagnostics = collectDiagnostics(resolved);

  if (rawConfig !== undefined) {
    const config = parseConfig(rawConfig);
    const records = projectAll(resolved, config);
    return { mode: 'projected', count: records.length, config, records, diagnostics };
  }

  const profiles = resolved.map((r) => validateDefault(r.profile));
  return { mode: 'default', count: profiles.length, profiles, diagnostics };
}

function collectDiagnostics(resolved: readonly ResolvedProfile[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of resolved) {
    for (const note of r.notes) {
      if (!seen.has(note)) {
        seen.add(note);
        out.push(note);
      }
    }
  }
  return out;
}
