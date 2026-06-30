import { describe, it, expect } from 'vitest';
import { transform } from '../src/core/pipeline.js';
import { canonicalProfileSchema } from '../src/core/schema/canonical.js';
import type { DefaultResult, ProjectedResult } from '../src/core/pipeline.js';
import type { RawSource } from '../src/core/types.js';

// A single candidate spread across five sources with conflicts, duplicates and a
// garbage source mixed in. Self-contained so the test does not depend on sample files.
const SOURCES: RawSource[] = [
  {
    type: 'csv',
    name: 'recruiter.csv',
    content:
      'Name,Email,Mobile Number,Current Company,Title,Location,Skills,LinkedIn\n' +
      '"Lovelace, Ada",Ada@AnalyticalEngine.io,ext. 4421,Analytical Engines Ltd,Principal Engineer,"London, United Kingdom","JS; PostgreSQL; k8s",linkedin.com/in/adalovelace\n',
  },
  {
    type: 'ats_json',
    name: 'greenhouse.json',
    content: JSON.stringify({
      applicant: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        primary_email: 'ada@analyticalengine.io',
        mobile: '0044 20 7946 0958',
        current_title: 'Principal Software Engineer',
        current_employer: 'Analytical Engines',
        location: { city: 'London', country: 'UK' },
        tags: ['JavaScript', 'PostgreSQL', 'Kubernetes'],
        social_links: { github: 'https://github.com/adalovelace' },
        work_history: [{ org: 'Analytical Engines Ltd', role: 'Principal Engineer', from: '2019-03', to: 'present' }],
        schools: [{ name: 'University of London', qualification: 'BSc', major: 'Mathematics', graduated: 2010 }],
      },
    }),
  },
  {
    type: 'github',
    name: 'adalovelace',
    content: JSON.stringify({
      user: { login: 'adalovelace', name: 'Ada Lovelace', html_url: 'https://github.com/adalovelace', location: 'London, UK' },
      repos: [{ languages: { 'C++': 9000, Python: 3000 } }],
    }),
  },
  { type: 'notes', name: 'notes.txt', content: 'Phone: +44 20 7946 0958\nSkills: Python, mentoring' },
  { type: 'ats_json', name: 'broken.json', content: '{ this is : not valid json' }, // garbage
];

describe('transform — default schema', () => {
  const result = transform(SOURCES) as DefaultResult;

  it('merges five sources (incl. one garbage) into a single valid profile', () => {
    expect(result.mode).toBe('default');
    expect(result.count).toBe(1);
    expect(() => canonicalProfileSchema.parse(result.profiles[0])).not.toThrow();
  });

  it('produces a correct gold profile', () => {
    const p = result.profiles[0]!;
    expect(p.full_name).toBe('Ada Lovelace');
    expect(p.emails).toEqual(['ada@analyticalengine.io']);
    expect(p.phones).toEqual(['+442079460958']); // CSV "ext. 4421" dropped; ATS+notes corroborate
    expect(p.location).toEqual({ city: 'London', region: null, country: 'GB' }); // UK + United Kingdom -> GB
    expect(p.links.github).toBe('https://github.com/adalovelace');
    expect(p.headline).toBe('Principal Software Engineer');
    // JavaScript corroborated by CSV + ATS; Python by github + notes.
    const js = p.skills.find((s) => s.name === 'JavaScript')!;
    expect(js.sources).toEqual(expect.arrayContaining(['csv:recruiter.csv', 'ats_json:greenhouse.json']));
    expect(js.confidence).toBeGreaterThan(0.9);
    expect(p.experience[0]).toMatchObject({ company: 'Analytical Engines Ltd', start: '2019-03', end: 'present' });
    expect(p.education[0]).toMatchObject({ institution: 'University of London', end_year: 2010 });
    expect(p.provenance.length).toBeGreaterThan(0);
    expect(p.overall_confidence).toBeGreaterThan(0.9);
  });

  it('reports the dropped phone as a diagnostic (honest, not silent)', () => {
    expect(result.diagnostics.some((d) => d.includes('dropped phone'))).toBe(true);
  });
});

describe('transform — projected mode + determinism', () => {
  it('projects through a runtime config and validates the result', () => {
    const result = transform(SOURCES, {
      config: {
        fields: [
          { path: 'name', from: 'full_name', type: 'string', required: true },
          { path: 'email', from: 'emails[0]', type: 'string', required: true },
          { path: 'phone', from: 'phones[0]', type: 'string', normalize: 'E164' },
          { path: 'skills', from: 'skills[].name', type: 'string[]' },
        ],
        on_missing: 'null',
      },
    }) as ProjectedResult;
    expect(result.mode).toBe('projected');
    expect(result.records[0]).toMatchObject({ name: 'Ada Lovelace', email: 'ada@analyticalengine.io', phone: '+442079460958' });
  });

  it('is deterministic: two runs are byte-identical', () => {
    const a = JSON.stringify((transform(SOURCES) as DefaultResult).profiles);
    const b = JSON.stringify((transform([...SOURCES].reverse()) as DefaultResult).profiles);
    expect(a).toBe(b);
  });
});
