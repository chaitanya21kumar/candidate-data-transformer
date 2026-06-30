/**
 * Stage 3: entity resolution. Cluster source records that refer to the same person.
 *
 * Two phases, reflecting a strict trust hierarchy:
 *
 *   Phase 1 — STRONG keys (email > phone > GitHub handle) are authoritative. Records
 *   sharing any strong key are unioned. Linking is transitive (A~B and B~C ⇒ {A,B,C})
 *   via union-find, so corroborating identifiers chain records regardless of order.
 *
 *   Phase 2 — name+company is a WEAK fallback used only to attach records that carry no
 *   strong identifier of their own (e.g. a recruiter note). It never merges two records
 *   that each have a strong identifier, so two different people who happen to share a
 *   name and employer are kept apart. If a note's name+company matches more than one
 *   distinct strong identity, it is left unmerged rather than guessed (honestly-empty).
 *
 * A name on its own is never a key.
 */
import { nameKey } from '../normalize/name.js';
import { githubUsername } from '../normalize/url.js';
import { foldCompany } from './util.js';
import type { NormalizedField, NormalizedExperience } from './normalizeFields.js';

class UnionFind {
  private parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      // Deterministic root: keep the lexicographically smaller id.
      if (ra < rb) this.parent.set(rb, ra);
      else this.parent.set(ra, rb);
    }
  }
}

export function resolveEntities(fields: readonly NormalizedField[]): NormalizedField[][] {
  // Preserve first-seen record order for deterministic output.
  const order: string[] = [];
  const byRecord = new Map<string, NormalizedField[]>();
  for (const f of fields) {
    if (!byRecord.has(f.recordId)) {
      byRecord.set(f.recordId, []);
      order.push(f.recordId);
    }
    byRecord.get(f.recordId)!.push(f);
  }

  const uf = new UnionFind();
  for (const id of order) uf.add(id);

  // --- Phase 1: strong, authoritative keys ---
  const anchored = new Set<string>();
  const strongOwner = new Map<string, string>();
  for (const id of order) {
    const strong = strongKeys(byRecord.get(id)!);
    if (strong.length > 0) anchored.add(id);
    for (const key of strong) {
      const owner = strongOwner.get(key);
      if (owner === undefined) strongOwner.set(key, id);
      else uf.union(owner, id);
    }
  }

  // --- Phase 2: name+company, only to attach un-anchored records, unambiguously ---
  const ncGroups = new Map<string, string[]>();
  for (const id of order) {
    for (const key of nameCompanyKeys(byRecord.get(id)!)) {
      if (!ncGroups.has(key)) ncGroups.set(key, []);
      ncGroups.get(key)!.push(id);
    }
  }
  for (const ids of ncGroups.values()) {
    const loose = ids.filter((id) => !anchored.has(id));
    if (loose.length === 0) continue;
    // Union the un-anchored records sharing this name+company together.
    for (let i = 1; i < loose.length; i++) uf.union(loose[0]!, loose[i]!);
    // Attach them to an anchored identity only if there is exactly one.
    const anchoredRoots = [...new Set(ids.filter((id) => anchored.has(id)).map((id) => uf.find(id)))];
    if (anchoredRoots.length === 1) uf.union(anchoredRoots[0]!, loose[0]!);
  }

  // Collect clusters, preserving first-seen order.
  const clusters = new Map<string, NormalizedField[]>();
  for (const id of order) {
    const root = uf.find(id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(...byRecord.get(id)!);
  }
  return [...clusters.values()];
}

/** Strong identity keys: email, phone, GitHub handle. */
function strongKeys(record: NormalizedField[]): string[] {
  const keys = new Set<string>();
  for (const f of record) {
    switch (f.path) {
      case 'email':
        if (typeof f.value === 'string') keys.add(`email:${f.value}`);
        break;
      case 'phone':
        if (typeof f.value === 'string') keys.add(`phone:${f.value}`);
        break;
      case 'links.github': {
        const handle = githubUsername(f.value);
        if (handle) keys.add(`gh:${handle}`);
        break;
      }
    }
  }
  return [...keys];
}

/** Weak keys: normalized name combined with each company the record mentions. */
function nameCompanyKeys(record: NormalizedField[]): string[] {
  let name = '';
  const companies = new Set<string>();
  for (const f of record) {
    if (f.path === 'full_name' && typeof f.value === 'string') name = nameKey(f.value);
    else if (f.path === 'experience') {
      const company = (f.value as NormalizedExperience).company;
      if (company) companies.add(foldCompany(company));
    }
  }
  if (!name) return [];
  return [...companies].filter(Boolean).map((c) => `nc:${name}|${c}`);
}
