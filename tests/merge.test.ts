import { describe, it, expect } from 'vitest';
import { extractAll } from '../src/core/adapters/index.js';
import { mergeToProfiles } from '../src/core/merge/index.js';
import type { RawSource } from '../src/core/types.js';

const merge = (sources: RawSource[]) => mergeToProfiles(extractAll(sources));

describe('entity resolution', () => {
  it('links records transitively across sources (email -> phone -> github)', () => {
    // CSV shares email with ATS; CSV shares phone with notes; CSV shares github handle
    // with the github source. All four should collapse into one person.
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Mobile,GitHub\nAda Lovelace,ada@x.io,+44 20 7946 0958,github.com/ada\n' },
      { type: 'ats_json', name: 'a.json', content: JSON.stringify({ name: 'Ada L', primary_email: 'ada@x.io', current_title: 'Engineer' }) },
      { type: 'notes', name: 'n.txt', content: 'Phone: +44 20 7946 0958\nSkills: Rust' },
      { type: 'github', name: 'ada', content: JSON.stringify({ user: { login: 'ada', name: 'Ada Lovelace', html_url: 'https://github.com/ada' }, repos: [{ language: 'Go' }] }) },
    ];
    const profiles = merge(sources);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.profile.emails).toEqual(['ada@x.io']);
    expect(profiles[0]!.profile.skills.map((s) => s.name).sort()).toEqual(['Go', 'Rust']);
  });

  it('never merges two different people who only share a name', () => {
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email\nJohn Smith,john.a@x.io\nJohn Smith,john.b@y.io\n' },
    ];
    const profiles = merge(sources);
    expect(profiles).toHaveLength(2);
  });

  it('uses name+company only to attach an un-anchored record (a note)', () => {
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Current Company,Title\nJohn Smith,john.a@x.io,Acme Corp,Engineer\n' },
      { type: 'notes', name: 'n.txt', content: 'Name: John Smith\nCurrently Engineer at Acme Corp.\nSkills: Go' },
    ];
    expect(merge(sources)).toHaveLength(1);
  });

  it('does NOT let name+company override differing strong identifiers', () => {
    // Same name and company, but different emails -> two real people, kept apart.
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Current Company,Title\nJohn Smith,john.a@x.io,Acme Corp,Engineer\nJohn Smith,john.b@y.io,Acme Corp,Engineer\n' },
    ];
    expect(merge(sources)).toHaveLength(2);
  });

  it('never bridges two different anchored people through a loose record (cross-key)', () => {
    // Two distinct people (different emails): Sam Carter @ Acme and Sam Carter @ Globex.
    // A note names "Sam Carter" with BOTH companies — it must not merge the two people.
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Current Company,Title\nSam Carter,sam.a@x.io,Acme,Engineer\nSam Carter,sam.b@y.io,Globex,Engineer\n' },
      { type: 'notes', name: 'n.txt', content: 'Name: Sam Carter\nWorked as Engineer at Acme and later Engineer at Globex.' },
    ];
    const profiles = merge(sources);
    const emails = profiles.flatMap((p) => p.profile.emails).sort();
    // The two anchored people stay separate (their two emails never co-occur in one profile).
    expect(profiles.find((p) => p.profile.emails.includes('sam.a@x.io'))!.profile.emails).not.toContain('sam.b@y.io');
    expect(emails).toEqual(['sam.a@x.io', 'sam.b@y.io']);
  });

  it('leaves a note unmerged when its name+company is ambiguous across people', () => {
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Current Company,Title\nJohn Smith,john.a@x.io,Acme Corp,Engineer\nJohn Smith,john.b@y.io,Acme Corp,Engineer\n' },
      { type: 'notes', name: 'n.txt', content: 'Name: John Smith\nCurrently Engineer at Acme Corp.\nSkills: Go' },
    ];
    // Two anchored people + one ambiguous note that cannot be attributed -> 3 clusters.
    expect(merge(sources)).toHaveLength(3);
  });
});

describe('conflict resolution and honestly-empty', () => {
  it('drops an unparseable phone but keeps a valid one from another source', () => {
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Mobile\nAda,ada@x.io,not-a-number\n' },
      { type: 'ats_json', name: 'a.json', content: JSON.stringify({ name: 'Ada', primary_email: 'ada@x.io', mobile: '+44 20 7946 0958' }) },
    ];
    const profile = merge(sources)[0]!;
    expect(profile.profile.phones).toEqual(['+442079460958']);
    expect(profile.notes.join(' ')).toContain('dropped phone');
  });

  it('prefers a higher-confidence source for a single-valued conflict', () => {
    // CSV (trust 0.90, structured) vs notes (trust 0.55) disagree on headline.
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Headline\nAda,ada@x.io,Staff Engineer\n' },
      { type: 'notes', name: 'n.txt', content: 'Email: ada@x.io\nHeadline: Junior Developer' },
    ];
    const profile = merge(sources)[0]!.profile;
    expect(profile.headline).toBe('Staff Engineer');
  });
});

describe('confidence model', () => {
  it('boosts a value corroborated by several sources above any single source', () => {
    const single: RawSource[] = [{ type: 'notes', name: 'n.txt', content: 'Email: ada@x.io\nSkills: Rust' }];
    const corroborated: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Skills\nAda,ada@x.io,Rust\n' },
      { type: 'ats_json', name: 'a.json', content: JSON.stringify({ name: 'Ada', primary_email: 'ada@x.io', tags: ['Rust'] }) },
      { type: 'notes', name: 'n.txt', content: 'Email: ada@x.io\nSkills: Rust' },
    ];
    const singleConf = merge(single)[0]!.profile.skills[0]!.confidence;
    const manyConf = merge(corroborated)[0]!.profile.skills[0]!.confidence;
    expect(manyConf).toBeGreaterThan(singleConf);
    expect(manyConf).toBeLessThanOrEqual(1);
  });

  it('de-duplicates non-canonical skills case-insensitively, keeping the best casing', () => {
    const sources: RawSource[] = [
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Skills\nAda,ada@x.io,"Distributed Systems; COBOL"\n' },
      { type: 'notes', name: 'n.txt', content: 'Email: ada@x.io\nSkills: distributed systems, cobol' },
    ];
    const names = merge(sources)[0]!.profile.skills.map((s) => s.name);
    expect(names).toContain('Distributed Systems');
    expect(names).toContain('COBOL');
    expect(names.filter((n) => n.toLowerCase() === 'distributed systems')).toHaveLength(1);
    expect(names.filter((n) => n.toLowerCase() === 'cobol')).toHaveLength(1);
  });

  it('orders multi-valued emails so [0] is the most trustworthy', () => {
    const sources: RawSource[] = [
      // Same person (linked by phone); a high-trust email and a low-trust one.
      { type: 'csv', name: 'r.csv', content: 'Name,Email,Mobile\nAda,trusted@x.io,+44 20 7946 0958\n' },
      { type: 'notes', name: 'n.txt', content: 'Phone: +44 20 7946 0958\nEmail: casual@y.io' },
    ];
    const emails = merge(sources)[0]!.profile.emails;
    expect(emails[0]).toBe('trusted@x.io');
    expect(emails).toContain('casual@y.io');
  });
});

describe('determinism', () => {
  it('produces identical output regardless of source order', () => {
    const a: RawSource = { type: 'csv', name: 'r.csv', content: 'Name,Email,Skills\nAda,ada@x.io,"Rust, Go"\n' };
    const b: RawSource = { type: 'ats_json', name: 'a.json', content: JSON.stringify({ name: 'Ada', primary_email: 'ada@x.io', tags: ['Python'] }) };
    const forward = JSON.stringify(merge([a, b]).map((p) => p.profile));
    const reverse = JSON.stringify(merge([b, a]).map((p) => p.profile));
    expect(forward).toBe(reverse);
  });

  it('assigns a stable candidate_id derived from the primary email', () => {
    const sources: RawSource[] = [{ type: 'csv', name: 'r.csv', content: 'Name,Email\nAda,ada@x.io\n' }];
    const id1 = merge(sources)[0]!.profile.candidate_id;
    const id2 = merge(sources)[0]!.profile.candidate_id;
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^cand_[0-9a-f]{16}$/);
  });
});
