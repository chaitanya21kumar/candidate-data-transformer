/**
 * Stage 3: entity resolution. Cluster source records that refer to the same person.
 *
 * Two records are linked when they share a strong identifier, in priority order:
 *   email > phone > GitHub handle > (name AND company together).
 * A name on its own is NEVER a match key — two different people often share a name, and
 * a false merge silently corrupts a profile, which is exactly the failure mode we must
 * avoid. Linking is transitive (A~B and B~C ⇒ {A,B,C}) via union-find, so corroborating
 * identifiers chain records together correctly regardless of source order.
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
    // Path compression.
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
      // Deterministic root: keep the lexicographically smaller id as the root.
      if (ra < rb) this.parent.set(rb, ra);
      else this.parent.set(ra, rb);
    }
  }
}

/** Group normalized fields into clusters, one per resolved person. */
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

  // key -> first record that owns it; subsequent owners get unioned.
  const keyOwner = new Map<string, string>();
  for (const id of order) {
    for (const key of matchKeys(byRecord.get(id)!)) {
      const owner = keyOwner.get(key);
      if (owner === undefined) keyOwner.set(key, id);
      else uf.union(owner, id);
    }
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

/** Strong identity keys for one record. */
function matchKeys(record: NormalizedField[]): string[] {
  const keys = new Set<string>();
  let name = '';
  const companies = new Set<string>();

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
      case 'full_name':
        if (typeof f.value === 'string') name = nameKey(f.value);
        break;
      case 'experience': {
        const company = (f.value as NormalizedExperience).company;
        if (company) companies.add(foldCompany(company));
        break;
      }
    }
  }

  // name + company is the weakest accepted key (never name alone).
  if (name) for (const company of companies) if (company) keys.add(`nc:${name}|${company}`);

  return [...keys];
}
