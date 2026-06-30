/**
 * Recruiter CSV adapter.
 *
 * Each data row is one source record. Header names are matched tolerantly against a
 * synonym table, so "E-mail", "Mobile Number", "Current Company", etc. all land in the
 * right canonical slot. Values are emitted raw (normalization happens centrally later);
 * the adapter's job is faithful extraction and provenance, never interpretation.
 */
import type { ExperienceInput, ExtractedField, FieldPath, RawSource, SourceRef } from '../types.js';
import { parseCsv } from './csvParser.js';
import { isBlank, makeField, splitList } from './util.js';

type Column =
  | 'full_name'
  | 'email'
  | 'phone'
  | 'company'
  | 'title'
  | 'headline'
  | 'location'
  | 'city'
  | 'region'
  | 'country'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'skills'
  | 'years_experience';

const HEADER_SYNONYMS: Record<Column, string[]> = {
  full_name: ['name', 'full name', 'fullname', 'candidate', 'candidate name'],
  email: ['email', 'email address', 'e mail', 'mail', 'emails'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'contact', 'contact number', 'telephone', 'cell'],
  company: ['current company', 'company', 'employer', 'organization', 'organisation', 'current employer'],
  title: ['title', 'current title', 'job title', 'role', 'designation', 'position'],
  headline: ['headline', 'summary', 'tagline'],
  location: ['location', 'based in', 'address'],
  city: ['city', 'town'],
  region: ['region', 'state', 'province'],
  country: ['country', 'nation'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
  github: ['github', 'github url', 'github profile'],
  portfolio: ['portfolio', 'website', 'personal site', 'site'],
  skills: ['skills', 'skill set', 'key skills', 'skillset'],
  years_experience: ['years of experience', 'years experience', 'experience', 'yoe', 'total experience'],
};

function buildHeaderMap(header: string[]): Map<number, Column> {
  const map = new Map<number, Column>();
  header.forEach((raw, index) => {
    const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    for (const [column, synonyms] of Object.entries(HEADER_SYNONYMS) as [Column, string[]][]) {
      if (synonyms.includes(key)) {
        map.set(index, column);
        break;
      }
    }
  });
  return map;
}

export function csvAdapter(source: RawSource): ExtractedField[] {
  const fields: ExtractedField[] = [];
  try {
    const rows = parseCsv(source.content);
    if (rows.length < 2) return fields; // need a header + at least one row
    const header = rows[0]!;
    const headerMap = buildHeaderMap(header);
    if (headerMap.size === 0) return fields; // unrecognizable header => contribute nothing

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]!;
      const recordId = `${source.type}:${source.name}#${r - 1}`;
      const cells = new Map<Column, string>();
      headerMap.forEach((column, index) => {
        const value = row[index];
        if (value !== undefined && !isBlank(value)) cells.set(column, value.trim());
      });

      pushSimple(fields, recordId, source, cells, 'full_name', 'full_name');
      pushMulti(fields, recordId, source, cells, 'email', 'email');
      pushMulti(fields, recordId, source, cells, 'phone', 'phone');
      pushSimple(fields, recordId, source, cells, 'headline', 'headline');
      pushSimple(fields, recordId, source, cells, 'years_experience', 'years_experience');
      pushSimple(fields, recordId, source, cells, 'linkedin', 'links.linkedin');
      pushSimple(fields, recordId, source, cells, 'github', 'links.github');
      pushSimple(fields, recordId, source, cells, 'portfolio', 'links.portfolio');
      pushSimple(fields, recordId, source, cells, 'city', 'location.city');
      pushSimple(fields, recordId, source, cells, 'region', 'location.region');
      pushSimple(fields, recordId, source, cells, 'country', 'location.country');

      // Skills: one cell -> many skill claims.
      const skills = cells.get('skills');
      if (skills) {
        for (const skill of splitList(skills, { bullets: true })) {
          fields.push(makeField({ recordId, source, path: 'skill', value: skill, method: 'structured_field' }));
        }
      }

      // A combined "City, Country" location cell.
      const location = cells.get('location');
      if (location && !cells.has('city') && !cells.has('country')) {
        const parts = splitList(location);
        if (parts.length >= 2) {
          fields.push(makeField({ recordId, source, path: 'location.city', value: parts[0], method: 'structured_field' }));
          fields.push(makeField({ recordId, source, path: 'location.country', value: parts[parts.length - 1], method: 'structured_field' }));
        } else if (parts.length === 1) {
          fields.push(makeField({ recordId, source, path: 'location.city', value: parts[0], method: 'structured_field' }));
        }
      }

      // current_company + title -> a current experience entry.
      const company = cells.get('company');
      const title = cells.get('title');
      if (company || title) {
        const entry: ExperienceInput = {
          company: company ?? null,
          title: title ?? null,
          start: null,
          end: 'present',
          summary: null,
        };
        fields.push(makeField({ recordId, source, path: 'experience', value: entry, method: 'structured_field' }));
      }
    }
  } catch {
    // Defensive: a malformed CSV contributes what was parsed, never crashes the run.
  }
  return fields;
}

function pushSimple(
  out: ExtractedField[],
  recordId: string,
  source: SourceRef,
  cells: Map<Column, string>,
  column: Column,
  path: FieldPath,
): void {
  const value = cells.get(column);
  if (value !== undefined) {
    out.push(makeField({ recordId, source, path, value, method: 'structured_field' }));
  }
}

function pushMulti(
  out: ExtractedField[],
  recordId: string,
  source: SourceRef,
  cells: Map<Column, string>,
  column: Column,
  path: FieldPath,
): void {
  const value = cells.get(column);
  if (value === undefined) return;
  for (const part of splitList(value)) {
    out.push(makeField({ recordId, source, path, value: part, method: 'structured_field' }));
  }
}
