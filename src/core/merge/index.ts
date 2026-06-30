/**
 * Merge orchestration: normalize -> resolve entities -> build one profile per cluster.
 * Profiles are returned in a stable order (by candidate_id) so the whole pipeline is
 * deterministic end to end.
 */
import type { ExtractedField, ResolvedProfile } from '../types.js';
import { normalizeFields, type NormalizeOptions } from './normalizeFields.js';
import { resolveEntities } from './resolve.js';
import { buildProfile } from './build.js';

export function mergeToProfiles(
  fields: readonly ExtractedField[],
  opts: NormalizeOptions = {},
): ResolvedProfile[] {
  const { normalized, notes } = normalizeFields(fields, opts);
  const clusters = resolveEntities(normalized);

  const profiles = clusters.map((cluster) => {
    const resolved = buildProfile(cluster);
    // Attribute drop-notes to the profile whose cluster owns the record they came from.
    const recordIds = new Set(cluster.map((f) => f.recordId));
    resolved.notes = notes.filter((n) => recordIds.has(n.recordId)).map((n) => n.message);
    return resolved;
  });

  profiles.sort((a, b) => a.profile.candidate_id.localeCompare(b.profile.candidate_id));
  return profiles;
}

export { normalizeFields, resolveEntities, buildProfile };
export type { NormalizeOptions };
