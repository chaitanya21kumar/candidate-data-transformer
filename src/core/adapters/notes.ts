/**
 * Recruiter notes adapter (free-text .txt).
 *
 * Two passes, in trust order:
 *  1. Labeled lines ("Email: …", "Skills: …") — high confidence (labeled_field).
 *  2. A regex sweep of the whole note for emails, profile URLs, international phone
 *     numbers, years-of-experience and a "<title> at <company>" pattern — lower
 *     confidence (regex_extraction / heuristic).
 *
 * Values already captured by a label are not re-emitted by the sweep, so each fact has
 * a single, highest-trust provenance entry. The note is assumed to describe one person.
 */
import type { ExperienceInput, ExtractedField, FieldPath, RawSource } from '../types.js';
import { classifyUrl } from '../normalize/url.js';
import { isBlank, makeField, splitList } from './util.js';

const LABELS: Record<string, FieldPath> = {
  name: 'full_name',
  candidate: 'full_name',
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  phone: 'phone',
  mobile: 'phone',
  contact: 'phone',
  tel: 'phone',
  telephone: 'phone',
  cell: 'phone',
  linkedin: 'links.linkedin',
  github: 'links.github',
  portfolio: 'links.portfolio',
  website: 'links.portfolio',
  site: 'links.portfolio',
  skills: 'skill',
  expertise: 'skill',
  stack: 'skill',
  location: 'location.city',
  'based in': 'location.city',
  headline: 'headline',
  summary: 'headline',
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s,;)]+|\b(?:linkedin\.com|github\.com)\/[^\s,;)]+/gi;
const PHONE_RE = /(?:\+|00)\d[\d\s().-]{6,}\d/g;
const YEARS_RE = /(\d{1,2})\+?\s*(?:years?|yrs?)\b/i;
const TITLE_AT_RE = /\b(?:currently\s+)?(?:a |an )?([A-Za-z][A-Za-z+/ &]{2,40}?)\s+at\s+([A-Z][A-Za-z0-9&.,' -]{1,40})/;

export function notesAdapter(source: RawSource): ExtractedField[] {
  const fields: ExtractedField[] = [];
  try {
    const text = source.content;
    const recordId = `${source.type}:${source.name}#0`;
    const captured = new Set<string>(); // `${path}|${normalized value}` to avoid duplicate provenance

    const emit = (path: FieldPath, value: string, method: 'labeled_field' | 'regex_extraction' | 'heuristic') => {
      const key = `${path}|${value.trim().toLowerCase()}`;
      if (captured.has(key) || isBlank(value)) return;
      captured.add(key);
      fields.push(makeField({ recordId, source, path, value: value.trim(), method, raw: value.trim() }));
    };

    // --- Pass 1: labeled lines ---
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z][A-Za-z ./-]*?)\s*[:\-]\s*(.+)$/);
      if (!match || !match[1] || !match[2]) continue;
      const label = match[1].toLowerCase().trim();
      const value = match[2].trim();
      const path = LABELS[label];
      if (!path) continue;
      if (path === 'skill') {
        for (const skill of splitList(value, { bullets: true })) emit('skill', skill, 'labeled_field');
      } else if (path === 'email' || path === 'phone') {
        for (const part of splitList(value)) emit(path, part, 'labeled_field');
      } else if (path === 'location.city') {
        emitLocation(emit, value, 'labeled_field');
      } else {
        emit(path, value, 'labeled_field');
      }
    }

    // --- Pass 2: regex sweep of the whole note ---
    for (const m of text.matchAll(EMAIL_RE)) emit('email', m[0], 'regex_extraction');
    for (const m of text.matchAll(URL_RE)) {
      const kind = classifyUrl(m[0]);
      if (kind) emit(`links.${kind}` as FieldPath, m[0], 'regex_extraction');
    }
    for (const m of text.matchAll(PHONE_RE)) emit('phone', m[0], 'regex_extraction');

    const years = text.match(YEARS_RE);
    if (years && years[1]) emit('years_experience', years[1], 'regex_extraction');

    const titleAt = text.match(TITLE_AT_RE);
    if (titleAt && titleAt[1] && titleAt[2]) {
      const entry: ExperienceInput = {
        company: titleAt[2].trim().replace(/[.,]$/, ''),
        title: titleAt[1].replace(/^currently\s+/i, '').trim(),
        start: null,
        end: 'present',
        summary: null,
      };
      fields.push(makeField({ recordId, source, path: 'experience', value: entry, method: 'heuristic' }));
    }
  } catch {
    // Defensive: free text never crashes the run.
  }
  return fields;
}

function emitLocation(
  emit: (path: FieldPath, value: string, method: 'labeled_field' | 'regex_extraction' | 'heuristic') => void,
  value: string,
  method: 'labeled_field',
): void {
  const parts = splitList(value);
  if (parts.length >= 2) {
    emit('location.city', parts[0]!, method);
    emit('location.country', parts[parts.length - 1]!, method);
  } else if (parts.length === 1) {
    emit('location.city', parts[0]!, method);
  }
}
