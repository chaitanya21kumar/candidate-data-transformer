/**
 * ATS JSON adapter.
 *
 * The defining challenge of an ATS export is that it uses ITS OWN field names
 * ("primary_email", "current_employer", "work_history", "graduated", …) that do not
 * match our canonical schema. So this adapter is built around a tolerant, case-
 * insensitive key resolver: each canonical slot lists the ATS keys it may appear under.
 *
 * It also copes with shape variety — a single object, a `{ candidates: [...] }` wrapper,
 * a top-level array, or an `{ applicant: {...} }` envelope — and never throws.
 */
import type {
  EducationInput,
  ExperienceInput,
  ExtractedField,
  RawSource,
  SourceRef,
} from '../types.js';
import { isBlank, makeField } from './util.js';

export function atsJsonAdapter(source: RawSource): ExtractedField[] {
  const fields: ExtractedField[] = [];
  try {
    const parsed: unknown = JSON.parse(source.content);
    const records = extractRecords(parsed);
    records.forEach((record, index) => {
      if (!isObject(record)) return;
      const recordId = `${source.type}:${source.name}#${index}`;
      extractRecord(fields, recordId, source, record);
    });
  } catch {
    // Malformed JSON contributes nothing; the run continues.
  }
  return fields;
}

function extractRecord(
  out: ExtractedField[],
  recordId: string,
  source: SourceRef,
  record: Record<string, unknown>,
): void {
  const add = (path: Parameters<typeof makeField>[0]['path'], value: unknown) =>
    out.push(makeField({ recordId, source, path, value, method: 'structured_field' }));

  // Name: explicit full name, else first + last.
  const fullName = pickString(record, ['full_name', 'name', 'candidate_name', 'display_name']);
  if (fullName) add('full_name', fullName);
  else {
    const first = pickString(record, ['first_name', 'firstname', 'given_name']);
    const last = pickString(record, ['last_name', 'lastname', 'family_name', 'surname']);
    const combined = [first, last].filter(Boolean).join(' ').trim();
    if (combined) add('full_name', combined);
  }

  for (const email of pickValues(record, ['primary_email', 'email', 'email_address', 'alternate_emails', 'emails']))
    add('email', email);
  for (const phone of pickValues(record, ['mobile', 'phone', 'phone_number', 'mobile_number', 'contact_number', 'phones']))
    add('phone', phone);

  const headline = pickString(record, ['headline', 'current_title', 'title', 'role', 'summary']);
  if (headline) add('headline', headline);

  const years = pick(record, ['years_experience', 'years_of_experience', 'experience_years', 'yoe']);
  if (years !== undefined && !isBlank(years)) add('years_experience', years);

  // Location: nested object or flat keys.
  const loc = pick(record, ['location', 'address', 'geo']);
  if (isObject(loc)) {
    const city = pickString(loc, ['city', 'town', 'locality']);
    const region = pickString(loc, ['region', 'state', 'province']);
    const country = pickString(loc, ['country', 'country_code', 'nation']);
    if (city) add('location.city', city);
    if (region) add('location.region', region);
    if (country) add('location.country', country);
  } else {
    const city = pickString(record, ['city', 'location_city']);
    const region = pickString(record, ['region', 'state', 'province']);
    const country = pickString(record, ['country', 'country_code', 'location_country']);
    if (city) add('location.city', city);
    if (region) add('location.region', region);
    if (country) add('location.country', country);
  }

  // Links: nested object or flat *_url keys.
  const links = pick(record, ['social_links', 'links', 'profiles', 'socials']);
  const linkSource = isObject(links) ? links : record;
  const linkedin = pickString(linkSource, ['linkedin', 'linkedin_url', 'linkedin_profile']);
  const github = pickString(linkSource, ['github', 'github_url', 'github_profile']);
  const portfolio = pickString(linkSource, ['portfolio', 'website', 'personal_site', 'url']);
  if (linkedin) add('links.linkedin', linkedin);
  if (github) add('links.github', github);
  if (portfolio) add('links.portfolio', portfolio);

  // Skills / tags.
  for (const skill of pickValues(record, ['skills', 'tags', 'skill_tags', 'competencies'])) add('skill', skill);

  // Work history -> experience entries.
  const history = pick(record, ['work_history', 'experience', 'positions', 'jobs', 'employment']);
  for (const item of asArray(history)) {
    if (!isObject(item)) continue;
    const entry: ExperienceInput = {
      company: pickString(item, ['company', 'org', 'organization', 'employer', 'company_name']),
      title: pickString(item, ['title', 'role', 'position', 'job_title']),
      start: pickString(item, ['start', 'from', 'start_date', 'started']),
      end: pickString(item, ['end', 'to', 'end_date', 'ended']),
      summary: pickString(item, ['summary', 'notes', 'description']),
    };
    if (entry.company || entry.title) add('experience', entry);
  }

  // Schools -> education entries.
  const schools = pick(record, ['education', 'schools', 'degrees', 'academics']);
  for (const item of asArray(schools)) {
    if (!isObject(item)) continue;
    const entry: EducationInput = {
      institution: pickString(item, ['institution', 'school', 'name', 'university', 'college']),
      degree: pickString(item, ['degree', 'qualification', 'credential']),
      field: pickString(item, ['field', 'major', 'field_of_study', 'discipline']),
      end_year: toYearOrNull(pick(item, ['end_year', 'graduated', 'graduation_year', 'year', 'grad_year'])),
    };
    if (entry.institution || entry.degree) add('education', entry);
  }
}

// --- shape helpers -------------------------------------------------------------

/** Find the list of candidate records inside whatever envelope the ATS used. */
function extractRecords(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (isObject(parsed)) {
    for (const key of ['candidates', 'applicants', 'results', 'data', 'records']) {
      const value = getCI(parsed, key);
      if (Array.isArray(value)) return value;
    }
    for (const key of ['applicant', 'candidate', 'profile']) {
      const value = getCI(parsed, key);
      if (isObject(value)) return [value];
    }
    return [parsed]; // a bare candidate object
  }
  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/** Case-insensitive property read. */
function getCI(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lower) return obj[k];
  return undefined;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = getCI(obj, key);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  const value = pick(obj, keys);
  if (typeof value === 'string' && !isBlank(value)) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/** Collect string values across keys, flattening arrays (for emails/phones/skills). */
function pickValues(obj: Record<string, unknown>, keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const value = getCI(obj, key);
    for (const item of asArray(value)) {
      if (typeof item === 'string' && !isBlank(item)) out.push(item.trim());
      else if (typeof item === 'number') out.push(String(item));
    }
  }
  return out;
}

function toYearOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/\b(19\d{2}|20\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return null;
}
