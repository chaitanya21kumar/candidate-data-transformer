/**
 * Resume adapter (works on text already extracted from PDF/DOCX by the I/O layer).
 *
 * Resume layouts vary wildly, so extraction is deliberately conservative and clearly
 * tiered by confidence:
 *  - Contact details (email / phone / profile URLs) via a regex sweep — reliable.
 *  - The candidate name from the top line — heuristic, low confidence.
 *  - SKILLS / EDUCATION / EXPERIENCE sections parsed best-effort when present.
 *
 * Anything it cannot parse confidently is simply left out (honestly-empty), and it
 * never throws.
 */
import type {
  EducationInput,
  ExperienceInput,
  ExtractedField,
  FieldPath,
  RawSource,
} from '../types.js';
import { classifyUrl } from '../normalize/url.js';
import { isBlank, makeField, splitList } from './util.js';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s,;)]+|\b(?:linkedin\.com|github\.com)\/[^\s,;)]+/gi;
const PHONE_RE = /(?:\+|00)\d[\d\s().-]{6,}\d/g;

const SECTION_HEADERS: Record<string, string> = {
  skills: 'skills',
  'technical skills': 'skills',
  'skills summary': 'skills',
  'core competencies': 'skills',
  education: 'education',
  experience: 'experience',
  'work experience': 'experience',
  'professional experience': 'experience',
  employment: 'experience',
};

const DEGREE_RE = /\b(B\.?Tech|B\.?E|M\.?Tech|M\.?E|B\.?Sc|M\.?Sc|B\.?A|M\.?A|Ph\.?D|MBA|Bachelor(?:'s)?|Master(?:'s)?|Diploma)\b/i;
const DATE_RANGE_RE = /([A-Za-z]{3,9}\.?\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2})\s*(?:-|–|—|to)\s*([A-Za-z]{3,9}\.?\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2}|present|current)/i;

export function resumeAdapter(source: RawSource): ExtractedField[] {
  const fields: ExtractedField[] = [];
  try {
    const text = source.content;
    const recordId = `${source.type}:${source.name}#0`;
    const seen = new Set<string>();
    const emit = (
      path: FieldPath,
      value: unknown,
      method: 'labeled_field' | 'regex_extraction' | 'heuristic',
    ) => {
      const dedupeKey = `${path}|${typeof value === 'string' ? value.trim().toLowerCase() : JSON.stringify(value)}`;
      if (seen.has(dedupeKey)) return;
      if (typeof value === 'string' && isBlank(value)) return;
      seen.add(dedupeKey);
      fields.push(makeField({ recordId, source, path, value, method }));
    };

    // Contact sweep over the whole document.
    for (const m of text.matchAll(EMAIL_RE)) emit('email', m[0], 'regex_extraction');
    for (const m of text.matchAll(PHONE_RE)) emit('phone', m[0], 'regex_extraction');
    for (const m of text.matchAll(URL_RE)) {
      const kind = classifyUrl(m[0]);
      if (kind) emit(`links.${kind}` as FieldPath, m[0], 'regex_extraction');
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim());

    // Name: first non-empty line that looks like a person's name.
    for (const line of lines) {
      if (line.length === 0) continue;
      if (looksLikeName(line)) emit('full_name', line, 'heuristic');
      break;
    }

    // Sectionize and parse.
    const sections = splitSections(lines);
    const skillsLines = sections.get('skills');
    if (skillsLines) {
      for (const line of skillsLines) {
        const cleaned = line.replace(/^[A-Za-z ]{2,30}:/, ''); // drop a "Languages:" sub-label
        for (const skill of splitList(cleaned, { bullets: true })) emit('skill', skill, 'labeled_field');
      }
    }

    const educationLines = sections.get('education');
    if (educationLines) for (const entry of parseEducation(educationLines)) emit('education', entry, 'regex_extraction');

    const experienceLines = sections.get('experience');
    if (experienceLines) for (const entry of parseExperience(experienceLines)) emit('experience', entry, 'regex_extraction');
  } catch {
    // Defensive: never crash on an unexpected layout.
  }
  return fields;
}

function looksLikeName(line: string): boolean {
  const words = line.split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;
  if (line.includes('@') || /\d/.test(line) || /https?:/i.test(line)) return false;
  return /^[A-Za-z][A-Za-z'.-]*(\s+[A-Za-z][A-Za-z'.-]*)*$/.test(line);
}

function splitSections(lines: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines) {
    const key = line.toLowerCase().replace(/[:\s]+$/, '').trim();
    const header = SECTION_HEADERS[key];
    if (header && line.length <= 40) {
      current = header;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current && line.length > 0) sections.get(current)!.push(line);
  }
  return sections;
}

function parseEducation(lines: string[]): EducationInput[] {
  const entries: EducationInput[] = [];
  for (const line of lines) {
    const degreeMatch = line.match(DEGREE_RE);
    const yearMatch = line.match(/\b(19\d{2}|20\d{2})\b/g);
    if (!degreeMatch && !yearMatch) continue;
    const fieldMatch = line.match(/\bin\s+([A-Za-z &]{3,40})/i);
    // Institution: the part before a comma/dash, with degree/field text stripped.
    const institution = line
      .split(/[,–—-]/)[0]
      ?.replace(DEGREE_RE, '')
      .replace(/\bin\s+[A-Za-z &]+/i, '')
      .trim();
    entries.push({
      institution: institution && institution.length > 1 ? institution : null,
      degree: degreeMatch ? degreeMatch[0] : null,
      field: fieldMatch && fieldMatch[1] ? fieldMatch[1].trim() : null,
      end_year: yearMatch ? Number(yearMatch[yearMatch.length - 1]) : null,
    });
  }
  return entries;
}

function parseExperience(lines: string[]): ExperienceInput[] {
  const entries: ExperienceInput[] = [];
  for (const line of lines) {
    const range = line.match(DATE_RANGE_RE);
    const atMatch = line.match(/^(.*?)\s+(?:at|@|—|–|-|,)\s+(.*?)(?:\s*\(|$)/);
    if (!range && !atMatch) continue;
    let title: string | null = null;
    let company: string | null = null;
    if (atMatch && atMatch[1] && atMatch[2]) {
      title = stripDates(atMatch[1]).trim() || null;
      company = stripDates(atMatch[2]).trim() || null;
    }
    entries.push({
      company,
      title,
      start: range ? range[1] ?? null : null,
      end: range ? range[2] ?? null : null,
      summary: null,
    });
  }
  return entries;
}

function stripDates(value: string): string {
  return value.replace(DATE_RANGE_RE, '').replace(/[()]/g, '').trim();
}
