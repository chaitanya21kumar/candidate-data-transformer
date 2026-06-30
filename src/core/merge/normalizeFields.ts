/**
 * Stage 2 of the pipeline: turn raw extracted claims into normalized claims.
 *
 * Each claim's value is run through the format-specific normalizer for its slot. A claim
 * whose value cannot be honestly normalized (an unparseable phone, a year-only date, an
 * unknown country) is DROPPED here rather than carried forward wrong — the dropped item
 * is recorded as a diagnostic note. This is the single chokepoint where the
 * "honestly-empty over confidently-wrong" rule is enforced.
 */
import type { EducationInput, ExperienceInput, ExtractedField, FieldPath } from '../types.js';
import { round4 } from '../confidence.js';
import {
  normalizeName,
  normalizeEmail,
  normalizePhone,
  normalizeCountry,
  normalizeUrl,
  normalizeSkill,
  normalizeMonth,
  normalizeEndDate,
  extractYear,
} from '../normalize/index.js';

export interface NormalizedField {
  recordId: string;
  path: FieldPath;
  /** Normalized value: string for most slots, number for years, object for experience/education. */
  value: unknown;
  source: { type: ExtractedField['source']['type']; name: string };
  method: ExtractedField['method'];
  confidence: number;
}

export interface NormalizeOptions {
  /** ISO-3166 alpha-2 hint used to resolve phone numbers that lack a country code. */
  defaultCountry?: string;
}

/** A claim dropped during normalization, tagged with its record so it can be attributed. */
export interface DroppedNote {
  recordId: string;
  message: string;
}

export function normalizeFields(
  fields: readonly ExtractedField[],
  opts: NormalizeOptions = {},
): { normalized: NormalizedField[]; notes: DroppedNote[] } {
  const normalized: NormalizedField[] = [];
  const notes: DroppedNote[] = [];

  const keep = (f: ExtractedField, value: unknown, confidence = f.confidence) =>
    normalized.push({
      recordId: f.recordId,
      path: f.path,
      value,
      source: { type: f.source.type, name: f.source.name },
      method: f.method,
      confidence: round4(confidence),
    });

  const drop = (f: ExtractedField, why: string) =>
    notes.push({
      recordId: f.recordId,
      message: `dropped ${f.path}="${stringify(f.value)}" from ${f.source.type}:${f.source.name} (${why})`,
    });

  for (const f of fields) {
    switch (f.path) {
      case 'full_name': {
        const v = normalizeName(f.value);
        v ? keep(f, v) : drop(f, 'not a valid name');
        break;
      }
      case 'email': {
        const v = normalizeEmail(f.value);
        v ? keep(f, v) : drop(f, 'invalid email');
        break;
      }
      case 'phone': {
        const v = normalizePhone(f.value, opts.defaultCountry);
        v ? keep(f, v) : drop(f, 'not a valid E.164 phone');
        break;
      }
      case 'location.city':
      case 'location.region':
      case 'headline': {
        const v = cleanText(f.value);
        v ? keep(f, v) : drop(f, 'blank');
        break;
      }
      case 'location.country': {
        const v = normalizeCountry(f.value);
        v ? keep(f, v) : drop(f, 'unrecognized country');
        break;
      }
      case 'links.linkedin':
      case 'links.github':
      case 'links.portfolio':
      case 'links.other': {
        const v = normalizeUrl(f.value);
        v ? keep(f, v) : drop(f, 'invalid url');
        break;
      }
      case 'years_experience': {
        const v = parseYears(f.value);
        v !== null ? keep(f, v) : drop(f, 'not a plausible year count');
        break;
      }
      case 'skill': {
        const v = normalizeSkill(f.value);
        if (v) keep(f, v.name, f.confidence * (v.canonical ? 1 : 0.9));
        else drop(f, 'blank skill');
        break;
      }
      case 'experience': {
        const v = normalizeExperience(f.value);
        v ? keep(f, v) : drop(f, 'empty experience');
        break;
      }
      case 'education': {
        const v = normalizeEducation(f.value);
        v ? keep(f, v) : drop(f, 'empty education');
        break;
      }
    }
  }

  return { normalized, notes };
}

export interface NormalizedExperience {
  company: string | null;
  title: string | null;
  start: string | null;
  end: string | null;
  summary: string | null;
}

export interface NormalizedEducation {
  institution: string | null;
  degree: string | null;
  field: string | null;
  end_year: number | null;
}

function normalizeExperience(value: unknown): NormalizedExperience | null {
  if (typeof value !== 'object' || value === null) return null;
  const e = value as ExperienceInput;
  const out: NormalizedExperience = {
    company: cleanText(e.company),
    title: cleanText(e.title),
    start: normalizeMonth(e.start),
    end: normalizeEndDate(e.end),
    summary: cleanText(e.summary),
  };
  return out.company || out.title ? out : null;
}

function normalizeEducation(value: unknown): NormalizedEducation | null {
  if (typeof value !== 'object' || value === null) return null;
  const e = value as EducationInput;
  const out: NormalizedEducation = {
    institution: cleanText(e.institution),
    degree: cleanText(e.degree),
    field: cleanText(e.field),
    end_year: e.end_year != null ? extractYear(e.end_year) : null,
  };
  return out.institution || out.degree ? out : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.replace(/\s+/g, ' ').trim();
  return v.length > 0 ? v : null;
}

function parseYears(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value).match(/\d+(\.\d+)?/)?.[0]);
  if (!Number.isFinite(n) || n < 0 || n > 80) return null;
  return Math.round(n);
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
