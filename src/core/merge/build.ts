/**
 * Stage 4: build one canonical profile from a resolved cluster of normalized claims.
 *
 * Per-field policy:
 *  - Single-valued slots (name, headline, country, links, …): group identical values,
 *    combine the confidence of agreeing sources via noisy-OR, then pick the winner by
 *    (confidence, breadth of agreement, source trust, value) — a deterministic order.
 *  - Multi-valued slots (emails, phones, skills, …): union and de-duplicate, ordering by
 *    confidence so element [0] is the most trustworthy (which makes "emails[0]" a sound
 *    primary-email projection).
 *  - Every emitted value records provenance for each contributing source, and its
 *    confidence is stored for the projection layer. Experience/education are merged by a
 *    folded company/institution key.
 */
import type {
  CanonicalEducation,
  CanonicalExperience,
  CanonicalProfile,
  ExtractionMethod,
  ProvenanceEntry,
  ResolvedProfile,
  SourceType,
} from '../types.js';
import { SOURCE_TRUST, noisyOr, overallConfidence, OVERALL_WEIGHTS, round4 } from '../confidence.js';
import { candidateId } from '../hash.js';
import { githubUsername } from '../normalize/url.js';
import { nameKey } from '../normalize/name.js';
import { cmp } from '../order.js';
import { foldCompany, sourceId } from './util.js';
import type { NormalizedEducation, NormalizedExperience, NormalizedField } from './normalizeFields.js';

interface Contributor {
  sourceId: string;
  type: SourceType;
  method: ExtractionMethod;
  confidence: number;
}

interface ValueGroup<T> {
  value: T;
  confidence: number;
  contributors: Contributor[]; // unique (sourceId, method), sorted
  maxTrust: number;
}

export function buildProfile(cluster: readonly NormalizedField[]): ResolvedProfile {
  const byPath = new Map<string, NormalizedField[]>();
  for (const f of cluster) {
    if (!byPath.has(f.path)) byPath.set(f.path, []);
    byPath.get(f.path)!.push(f);
  }
  const get = (path: string): NormalizedField[] => byPath.get(path) ?? [];

  const provenance: ProvenanceEntry[] = [];
  const fieldConfidence: Record<string, number> = {};
  const addProvenance = (field: string, group: ValueGroup<unknown>) => {
    fieldConfidence[field] = group.confidence;
    for (const c of group.contributors) provenance.push({ field, source: c.sourceId, method: c.method });
  };

  // --- single-valued fields ---
  const full_name = pickSingle(get('full_name'));
  if (full_name) addProvenance('full_name', full_name);

  const headline = pickSingle(get('headline'));
  if (headline) addProvenance('headline', headline);

  const yearsGroup = pickSingle(get('years_experience'));
  if (yearsGroup) addProvenance('years_experience', yearsGroup);

  const city = pickSingle(get('location.city'));
  const region = pickSingle(get('location.region'));
  const country = pickSingle(get('location.country'));
  if (city) addProvenance('location.city', city);
  if (region) addProvenance('location.region', region);
  if (country) addProvenance('location.country', country);

  const linkedin = pickSingle(get('links.linkedin'));
  const github = pickSingle(get('links.github'));
  const portfolio = pickSingle(get('links.portfolio'));
  if (linkedin) addProvenance('links.linkedin', linkedin);
  if (github) addProvenance('links.github', github);
  if (portfolio) addProvenance('links.portfolio', portfolio);

  // --- multi-valued fields ---
  const emailGroups = pickMulti(get('email'));
  emailGroups.forEach((g, i) => addProvenance(`emails[${i}]`, g));
  const phoneGroups = pickMulti(get('phone'));
  phoneGroups.forEach((g, i) => addProvenance(`phones[${i}]`, g));
  // "other" links exclude any URL already filed under a specific link slot.
  const specificLinks = new Set(
    [linkedin?.value, github?.value, portfolio?.value].filter((v): v is string => typeof v === 'string'),
  );
  const otherGroups = pickMulti(get('links.other')).filter((g) => !specificLinks.has(g.value as string));
  otherGroups.forEach((g, i) => addProvenance(`links.other[${i}]`, g));

  const skillGroups = pickMulti(get('skill'), caseInsensitiveKey);
  const skills = skillGroups.map((g, i) => {
    addProvenance(`skills[${i}]`, g);
    return {
      name: g.value as string,
      confidence: g.confidence,
      sources: [...new Set(g.contributors.map((c) => c.sourceId))].sort(),
    };
  });

  const experience = buildExperience(get('experience'), provenance, fieldConfidence);
  const education = buildEducation(get('education'), provenance, fieldConfidence);

  // --- candidate id (deterministic, from the strongest available identifier) ---
  const githubSeed = github ? githubUsername(github.value as string) : null;
  const seed =
    (emailGroups[0]?.value as string | undefined) ??
    (phoneGroups[0]?.value as string | undefined) ??
    githubSeed ??
    identitySeed(full_name?.value as string | undefined, experience) ??
    cluster[0]?.recordId ??
    'unknown';
  const candidate_id = candidateId(seed);

  const profile: CanonicalProfile = {
    candidate_id,
    full_name: (full_name?.value as string) ?? null,
    emails: emailGroups.map((g) => g.value as string),
    phones: phoneGroups.map((g) => g.value as string),
    location: {
      city: (city?.value as string) ?? null,
      region: (region?.value as string) ?? null,
      country: (country?.value as string) ?? null,
    },
    links: {
      linkedin: (linkedin?.value as string) ?? null,
      github: (github?.value as string) ?? null,
      portfolio: (portfolio?.value as string) ?? null,
      other: otherGroups.map((g) => g.value as string),
    },
    headline: (headline?.value as string) ?? null,
    years_experience: (yearsGroup?.value as number) ?? null,
    skills,
    experience,
    education,
    provenance,
    overall_confidence: 0, // filled below
  };

  profile.overall_confidence = computeOverall(profile, fieldConfidence);
  return { profile, fieldConfidence, notes: [] };
}

// --- grouping & selection -------------------------------------------------------

type KeyFn = (value: unknown) => string;

const defaultKey: KeyFn = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
/** Case-insensitive key so skill casing variants ("distributed systems") collapse. */
const caseInsensitiveKey: KeyFn = (value) => (typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value));

function groupValues(fields: readonly NormalizedField[], keyFn: KeyFn = defaultKey): ValueGroup<unknown>[] {
  const groups = new Map<string, { values: unknown[]; perSource: Map<string, Contributor> }>();
  for (const f of fields) {
    const key = keyFn(f.value);
    if (!groups.has(key)) groups.set(key, { values: [], perSource: new Map() });
    const g = groups.get(key)!;
    g.values.push(f.value);
    const sid = sourceId(f.source);
    const ckey = `${sid}|${f.method}`;
    const existing = g.perSource.get(ckey);
    if (!existing || f.confidence > existing.confidence) {
      g.perSource.set(ckey, { sourceId: sid, type: f.source.type, method: f.method, confidence: f.confidence });
    }
  }

  const out: ValueGroup<unknown>[] = [];
  for (const { values, perSource } of groups.values()) {
    const value = pickDisplay(values);
    const contributors = [...perSource.values()].sort(
      (a, b) => cmp(a.sourceId, b.sourceId) || cmp(a.method, b.method),
    );
    // Corroboration combines confidence across distinct SOURCES (max per source first).
    const perSourceMax = new Map<string, number>();
    for (const c of contributors) perSourceMax.set(c.sourceId, Math.max(perSourceMax.get(c.sourceId) ?? 0, c.confidence));
    const confidence = noisyOr([...perSourceMax.values()]);
    const maxTrust = Math.max(...contributors.map((c) => SOURCE_TRUST[c.type]));
    out.push({ value, confidence, contributors, maxTrust });
  }

  out.sort(compareGroups);
  return out;
}

/** Deterministic ordering: best first. */
function compareGroups(a: ValueGroup<unknown>, b: ValueGroup<unknown>): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const aSources = new Set(a.contributors.map((c) => c.sourceId)).size;
  const bSources = new Set(b.contributors.map((c) => c.sourceId)).size;
  if (bSources !== aSources) return bSources - aSources;
  if (b.maxTrust !== a.maxTrust) return b.maxTrust - a.maxTrust;
  return cmp(String(a.value), String(b.value));
}

/** Among casing variants, choose the display with the most upper-case letters (keeps
 *  acronyms like "COBOL"/"SQL"); deterministic lexicographic tie-break. */
function pickDisplay(values: unknown[]): unknown {
  const strings = values.filter((v): v is string => typeof v === 'string');
  if (strings.length !== values.length || strings.length === 0) return values[0];
  const distinct = [...new Set(strings)];
  distinct.sort((a, b) => upperCount(b) - upperCount(a) || cmp(a, b));
  return distinct[0];
}

function upperCount(value: string): number {
  let n = 0;
  for (const ch of value) if (ch >= 'A' && ch <= 'Z') n++;
  return n;
}

function pickSingle(fields: readonly NormalizedField[], keyFn?: KeyFn): ValueGroup<unknown> | null {
  if (fields.length === 0) return null;
  return groupValues(fields, keyFn)[0] ?? null;
}

function pickMulti(fields: readonly NormalizedField[], keyFn?: KeyFn): ValueGroup<unknown>[] {
  return groupValues(fields, keyFn);
}

// --- experience & education -----------------------------------------------------

interface ExperienceAcc {
  entry: CanonicalExperience;
  contributors: Contributor[];
  companyFold: string;
  titled: boolean;
}

function buildExperience(
  fields: readonly NormalizedField[],
  provenance: ProvenanceEntry[],
  fieldConfidence: Record<string, number>,
): CanonicalExperience[] {
  // First pass: dedup by (company, title).
  const merged = new Map<string, ExperienceAcc>();
  for (const f of fields) {
    const e = f.value as NormalizedExperience;
    const companyFold = e.company ? foldCompany(e.company) : '';
    const titleFold = (e.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `${companyFold}|${titleFold}`;
    const contributor: Contributor = { sourceId: sourceId(f.source), type: f.source.type, method: f.method, confidence: f.confidence };
    const existing = merged.get(key);
    if (!existing) merged.set(key, { entry: { ...e }, contributors: [contributor], companyFold, titled: titleFold.length > 0 });
    else {
      existing.entry = coalesceExperience(existing.entry, e);
      existing.contributors.push(contributor);
    }
  }

  // Second pass: a bare company mention (no title) corroborates an existing titled role
  // at the same company rather than creating a separate entry.
  const accs = [...merged.values()];
  const kept: ExperienceAcc[] = [];
  for (const acc of accs) {
    if (acc.titled || acc.companyFold === '') {
      kept.push(acc);
      continue;
    }
    const host = kept.find((k) => k.titled && k.companyFold === acc.companyFold)
      ?? accs.find((k) => k !== acc && k.titled && k.companyFold === acc.companyFold);
    if (host) {
      host.entry = coalesceExperience(host.entry, acc.entry);
      host.contributors.push(...acc.contributors);
    } else {
      kept.push(acc);
    }
  }

  const items = kept.sort((a, b) => compareExperience(a.entry, b.entry));
  return items.map((m, i) => {
    finalizeContribution(`experience[${i}]`, m.contributors, provenance, fieldConfidence);
    return m.entry;
  });
}

function buildEducation(
  fields: readonly NormalizedField[],
  provenance: ProvenanceEntry[],
  fieldConfidence: Record<string, number>,
): CanonicalEducation[] {
  const merged = new Map<string, { entry: CanonicalEducation; contributors: Contributor[] }>();
  for (const f of fields) {
    const e = f.value as NormalizedEducation;
    const key = `${e.institution ? foldCompany(e.institution) : ''}|${(e.degree ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const contributor: Contributor = {
      sourceId: sourceId(f.source),
      type: f.source.type,
      method: f.method,
      confidence: f.confidence,
    };
    if (!merged.has(key)) merged.set(key, { entry: { ...e }, contributors: [contributor] });
    else {
      const m = merged.get(key)!;
      m.entry = coalesceEducation(m.entry, e);
      m.contributors.push(contributor);
    }
  }

  const items = [...merged.values()].sort((a, b) => (b.entry.end_year ?? 0) - (a.entry.end_year ?? 0));
  return items.map((m, i) => {
    finalizeContribution(`education[${i}]`, m.contributors, provenance, fieldConfidence);
    return m.entry;
  });
}

function finalizeContribution(
  field: string,
  contributors: Contributor[],
  provenance: ProvenanceEntry[],
  fieldConfidence: Record<string, number>,
): void {
  const perSourceMax = new Map<string, number>();
  for (const c of contributors) perSourceMax.set(c.sourceId, Math.max(perSourceMax.get(c.sourceId) ?? 0, c.confidence));
  fieldConfidence[field] = noisyOr([...perSourceMax.values()]);
  const unique = new Map<string, Contributor>();
  for (const c of contributors) unique.set(`${c.sourceId}|${c.method}`, c);
  for (const c of [...unique.values()].sort((a, b) => cmp(a.sourceId, b.sourceId) || cmp(a.method, b.method)))
    provenance.push({ field, source: c.sourceId, method: c.method });
}

function coalesceExperience(a: CanonicalExperience, b: NormalizedExperience): CanonicalExperience {
  return {
    company: a.company ?? b.company,
    title: a.title ?? b.title,
    start: a.start ?? b.start,
    end: preferEnd(a.end, b.end),
    summary: a.summary ?? b.summary,
  };
}

function coalesceEducation(a: CanonicalEducation, b: NormalizedEducation): CanonicalEducation {
  return {
    institution: a.institution ?? b.institution,
    degree: a.degree ?? b.degree,
    field: a.field ?? b.field,
    end_year: a.end_year ?? b.end_year,
  };
}

function preferEnd(a: string | null, b: string | null): string | null {
  if (a === 'present' || b === 'present') return 'present';
  return a ?? b;
}

function compareExperience(a: CanonicalExperience, b: CanonicalExperience): number {
  // Ongoing roles first, then most recent start, then company name for stability.
  const aPresent = a.end === 'present' ? 1 : 0;
  const bPresent = b.end === 'present' ? 1 : 0;
  if (aPresent !== bPresent) return bPresent - aPresent;
  const aStart = a.start ?? '0000-00';
  const bStart = b.start ?? '0000-00';
  if (aStart !== bStart) return cmp(bStart, aStart);
  return cmp(a.company ?? '', b.company ?? '');
}

// --- candidate id & overall confidence ------------------------------------------

function identitySeed(name: string | undefined, experience: CanonicalExperience[]): string | null {
  if (!name) return null;
  const company = experience.find((e) => e.company)?.company;
  // Only seed from name when paired with a company — a name alone is not distinguishing,
  // so two different name-only people would otherwise collide on candidate_id. Without a
  // company we let the caller fall back to the (globally unique) record id.
  return company ? `${nameKey(name)}|${foldCompany(company)}` : null;
}

function computeOverall(profile: CanonicalProfile, fieldConfidence: Record<string, number>): number {
  const present: { weight: number; confidence: number }[] = [];
  const add = (key: keyof typeof OVERALL_WEIGHTS, confidence: number | undefined) => {
    if (confidence !== undefined) present.push({ weight: OVERALL_WEIGHTS[key]!, confidence });
  };

  if (profile.full_name) add('full_name', fieldConfidence['full_name']);
  if (profile.emails.length) add('emails', fieldConfidence['emails[0]']);
  if (profile.phones.length) add('phones', fieldConfidence['phones[0]']);
  if (profile.location.country) add('location.country', fieldConfidence['location.country']);
  if (profile.headline) add('headline', fieldConfidence['headline']);
  if (profile.skills.length) add('skills', mean(profile.skills.map((s) => s.confidence)));
  if (profile.experience.length) add('experience', maxConf(fieldConfidence, 'experience', profile.experience.length));
  if (profile.education.length) add('education', maxConf(fieldConfidence, 'education', profile.education.length));
  const linkConf = bestLinkConfidence(profile, fieldConfidence);
  if (linkConf !== undefined) add('links', linkConf);

  return overallConfidence(present);
}

function mean(values: number[]): number {
  return values.length ? round4(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}

function maxConf(fieldConfidence: Record<string, number>, prefix: string, count: number): number {
  let best = 0;
  for (let i = 0; i < count; i++) best = Math.max(best, fieldConfidence[`${prefix}[${i}]`] ?? 0);
  return best;
}

function bestLinkConfidence(profile: CanonicalProfile, fieldConfidence: Record<string, number>): number | undefined {
  const candidates: number[] = [];
  for (const key of ['links.linkedin', 'links.github', 'links.portfolio']) {
    if (fieldConfidence[key] !== undefined) candidates.push(fieldConfidence[key]!);
  }
  for (let i = 0; i < profile.links.other.length; i++) {
    const c = fieldConfidence[`links.other[${i}]`];
    if (c !== undefined) candidates.push(c);
  }
  return candidates.length ? Math.max(...candidates) : undefined;
}
