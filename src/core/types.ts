/**
 * Core domain types shared across the whole pipeline.
 *
 * Design intent:
 *  - Adapters turn a {@link RawSource} into a flat list of {@link ExtractedField}s — one
 *    atomic, traceable claim each. Adapters NEVER throw; malformed input yields `[]`.
 *  - The merge stage clusters fields into people and resolves them into a
 *    {@link CanonicalProfile} (the single internal source of truth).
 *  - The projection stage reshapes a canonical profile into whatever the runtime
 *    config asks for. Canonical and projection are kept strictly separate.
 *
 * Everything here is pure data — no I/O, no node-only deps — so the same engine runs
 * unchanged in the CLI and in the browser UI.
 */

/** The source systems we know how to read. */
export type SourceType =
  | 'csv'        // recruiter CSV export (structured rows)
  | 'ats_json'   // ATS export with its own field names (semi-structured)
  | 'github'     // public GitHub profile (REST API or captured fixture)
  | 'notes'      // recruiter notes (free text .txt)
  | 'resume'     // resume prose extracted from PDF/DOCX/text
  | 'linkedin';  // LinkedIn export/URL (see DESIGN_NOTES for the deliberate scope limit)

/**
 * How a value was obtained. This feeds the confidence model: a value read from a
 * typed column is trusted more than one pattern-matched out of free prose.
 */
export type ExtractionMethod =
  | 'structured_field' // direct column/key in structured data (highest)
  | 'api_field'        // typed field from a structured API response
  | 'labeled_field'    // an explicitly labeled value in semi-structured text ("Phone: …")
  | 'regex_extraction' // pattern-matched from free text
  | 'heuristic';       // inferred heuristically (lowest)

/** Canonical "slots" an adapter can populate. Multi-valued slots (email, phone, skill,
 *  experience, education) are emitted once per value and merged downstream. */
export type FieldPath =
  | 'full_name'
  | 'email'
  | 'phone'
  | 'location.city'
  | 'location.region'
  | 'location.country'
  | 'links.linkedin'
  | 'links.github'
  | 'links.portfolio'
  | 'links.other'
  | 'headline'
  | 'years_experience'
  | 'skill'
  | 'experience'
  | 'education';

/** A pointer back to the exact source a value came from. */
export interface SourceRef {
  readonly type: SourceType;
  /** File name, URL, or other human-readable identifier. */
  readonly name: string;
}

/** Raw input handed to an adapter. `content` is always a string (file text, pasted
 *  text, or JSON text) so adapters stay isomorphic between CLI and browser. */
export interface RawSource {
  readonly type: SourceType;
  readonly name: string;
  readonly content: string;
}

/**
 * One atomic claim extracted from a single source record.
 *
 * `recordId` groups fields that came from the same physical record (one CSV row, one
 * ATS object, one GitHub profile). It is globally unique — `"<type>:<name>#<index>"` —
 * so it doubles as the node id during entity resolution.
 */
export interface ExtractedField {
  readonly recordId: string;
  readonly path: FieldPath;
  /** The extracted value, BEFORE normalization. */
  readonly value: unknown;
  readonly source: SourceRef;
  readonly method: ExtractionMethod;
  /** Pre-merge confidence in [0, 1]. */
  readonly confidence: number;
  /** Original raw snippet, kept for debugging/provenance where useful. */
  readonly raw?: string;
}

/** Partial experience entry as emitted by an adapter (fields fill in during merge). */
export interface ExperienceInput {
  company?: string | null;
  title?: string | null;
  start?: string | null;
  end?: string | null;
  summary?: string | null;
}

/** Partial education entry as emitted by an adapter. */
export interface EducationInput {
  institution?: string | null;
  degree?: string | null;
  field?: string | null;
  end_year?: number | null;
}

// ---------------------------------------------------------------------------
// Canonical profile — the internal single source of truth.
// This shape is EXACTLY the assignment's default output schema (nothing extra),
// so the default output is just a validated canonical profile.
// ---------------------------------------------------------------------------

export interface CanonicalLocation {
  city: string | null;
  region: string | null;
  /** ISO-3166 alpha-2, e.g. "IN", "US". */
  country: string | null;
}

export interface CanonicalLinks {
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
  other: string[];
}

export interface CanonicalSkill {
  /** Canonical skill name (e.g. "JavaScript"). */
  name: string;
  confidence: number;
  /** Contributing source identifiers ("<type>:<name>"). */
  sources: string[];
}

export interface CanonicalExperience {
  company: string | null;
  title: string | null;
  /** YYYY-MM or null. */
  start: string | null;
  /** YYYY-MM, "present", or null. */
  end: string | null;
  summary: string | null;
}

export interface CanonicalEducation {
  institution: string | null;
  degree: string | null;
  field: string | null;
  end_year: number | null;
}

export interface ProvenanceEntry {
  /** Canonical path, e.g. "phones[0]", "skills[2]", "location.country". */
  field: string;
  /** "<type>:<name>", e.g. "ats_json:greenhouse_export.json". */
  source: string;
  method: ExtractionMethod;
}

export interface CanonicalProfile {
  candidate_id: string;
  full_name: string | null;
  emails: string[];
  phones: string[];
  location: CanonicalLocation;
  links: CanonicalLinks;
  headline: string | null;
  years_experience: number | null;
  skills: CanonicalSkill[];
  experience: CanonicalExperience[];
  education: CanonicalEducation[];
  provenance: ProvenanceEntry[];
  /** [0, 1] aggregate trust in the profile. */
  overall_confidence: number;
}

/**
 * A canonical profile plus the internal metadata the projection layer needs but that
 * is NOT part of the default output (kept separate so the canonical shape stays clean).
 */
export interface ResolvedProfile {
  profile: CanonicalProfile;
  /** Confidence per concrete canonical path ("full_name", "emails[0]", "skills[1]", …). */
  fieldConfidence: Record<string, number>;
  /** Notes about anything dropped/skipped while building this profile (diagnostics). */
  notes: string[];
}
