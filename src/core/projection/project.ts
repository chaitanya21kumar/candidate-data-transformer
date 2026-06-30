/**
 * The projection layer: reshape a canonical profile into the output the runtime config
 * asks for, then validate it against a schema built from that same config.
 *
 * Kept strictly separate from the canonical record — projection only READS the profile.
 * It supports: selecting a subset of fields, remapping via `from`, per-field
 * normalization, toggling provenance/confidence, and the missing-value policy
 * (null | omit | error). The result is validated before it is returned.
 */
import type { ResolvedProfile } from '../types.js';
import { resolvePath } from './pathResolver.js';
import {
  buildOutputSchema,
  outputConfigSchema,
  type NormalizeKind,
  type OutputConfig,
} from '../schema/config.js';
import { normalizeCountry, normalizeMonth, normalizePhone, normalizeSkill } from '../normalize/index.js';

export class ProjectionError extends Error {
  override name = 'ProjectionError';
}

/** Validate and normalize an untrusted config object. */
export function parseConfig(raw: unknown): OutputConfig {
  const parsed = outputConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProjectionError(
      `Invalid output config: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

export function project(resolved: ResolvedProfile, config: OutputConfig): Record<string, unknown> {
  const onMissing = config.on_missing ?? 'null';
  const { profile, fieldConfidence } = resolved;

  const output: Record<string, unknown> = {};
  const confidence: Record<string, number | number[]> = {};
  const provenanceKeys = new Set<string>();

  for (const field of config.fields) {
    const fromExpr = field.from ?? field.path;
    const res = resolvePath(profile, fromExpr);
    let value = field.normalize ? applyNormalize(res.value, field.normalize) : res.value;

    if (isMissing(value)) {
      if (onMissing === 'error') {
        throw new ProjectionError(`Missing value for field "${field.path}" (from "${fromExpr}")`);
      }
      if (onMissing === 'omit') continue;
      output[field.path] = null; // on_missing === 'null'
      continue;
    }

    output[field.path] = value;

    // Resolve the confidence/provenance key(s) backing this projected value.
    const keys = res.paths
      .map((p) => confidenceKeyFor(fieldConfidence, p))
      .filter((k): k is string => k !== null);

    if (config.include_confidence) {
      confidence[field.path] = res.hadMap
        ? keys.map((k) => fieldConfidence[k] ?? 0)
        : (keys[0] !== undefined ? (fieldConfidence[keys[0]] ?? 0) : 0);
    }
    if (config.include_provenance) for (const k of keys) provenanceKeys.add(k);
  }

  if (config.include_confidence) {
    output['confidence'] = confidence;
    output['overall_confidence'] = profile.overall_confidence;
  }
  if (config.include_provenance) {
    output['provenance'] = profile.provenance.filter((e) => provenanceKeys.has(e.field));
  }

  const schema = buildOutputSchema(config);
  const validated = schema.safeParse(output);
  if (!validated.success) {
    throw new ProjectionError(
      `Projected output failed schema validation: ${validated.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return validated.data as Record<string, unknown>;
}

/** Project every profile; throws if any projection violates the requested schema. */
export function projectAll(resolved: readonly ResolvedProfile[], config: OutputConfig): Record<string, unknown>[] {
  return resolved.map((r) => project(r, config));
}

// --- helpers -------------------------------------------------------------------

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

function applyNormalize(value: unknown, kind: NormalizeKind): unknown {
  if (Array.isArray(value)) return value.map((v) => normalizeOne(v, kind)).filter((v) => v !== null);
  return normalizeOne(value, kind);
}

function normalizeOne(value: unknown, kind: NormalizeKind): unknown {
  switch (kind) {
    case 'E164':
      return typeof value === 'string' ? normalizePhone(value) : null;
    case 'canonical':
      return typeof value === 'string' ? (normalizeSkill(value)?.name ?? null) : null;
    case 'date':
      return normalizeMonth(value);
    case 'country':
      return normalizeCountry(value);
    case 'lower':
      return value == null ? null : String(value).toLowerCase();
    case 'upper':
      return value == null ? null : String(value).toUpperCase();
    case 'trim':
      return value == null ? null : String(value).trim();
  }
}

/**
 * Map a resolved leaf path to the key under which its confidence/provenance is stored.
 * `fieldConfidence` is keyed at value granularity ("skills[0]", "emails[0]",
 * "location.country"), so for a deeper leaf like "skills[0].name" we walk up to the
 * nearest stored key.
 */
function confidenceKeyFor(fieldConfidence: Record<string, number>, leaf: string): string | null {
  let path = leaf;
  while (path.length > 0) {
    if (path in fieldConfidence) return path;
    const dot = path.lastIndexOf('.');
    if (dot === -1) break;
    path = path.slice(0, dot);
  }
  return null;
}
