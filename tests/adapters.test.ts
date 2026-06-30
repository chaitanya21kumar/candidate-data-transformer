import { describe, it, expect } from 'vitest';
import { runAdapter } from '../src/core/adapters/index.js';
import { parseCsv } from '../src/core/adapters/csvParser.js';
import type { ExtractedField, FieldPath, RawSource } from '../src/core/types.js';

const valuesFor = (fields: ExtractedField[], path: FieldPath): unknown[] =>
  fields.filter((f) => f.path === path).map((f) => f.value);

describe('parseCsv (RFC-4180)', () => {
  it('handles quotes, escaped quotes, and embedded commas/newlines', () => {
    const rows = parseCsv('a,b\n"hello, world","line1\nline2"\n"she said ""hi""",x');
    expect(rows).toEqual([
      ['a', 'b'],
      ['hello, world', 'line1\nline2'],
      ['she said "hi"', 'x'],
    ]);
  });
  it('tolerates CRLF and trailing newlines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvAdapter', () => {
  const source: RawSource = {
    type: 'csv',
    name: 'recruiter.csv',
    content:
      'Name,Email,Mobile Number,Current Company,Title,Skills,LinkedIn\n' +
      '"Lovelace, Ada",ADA@Example.com,+44 20 7946 0958,Analytical Engines,Principal Engineer,"Python; C++; k8s",linkedin.com/in/ada\n' +
      'Bob Smith,bob@x.io,,Acme,,JS,',
  };
  const fields = runAdapter(source);

  it('maps tolerant headers to canonical slots', () => {
    expect(valuesFor(fields, 'full_name')).toEqual(['Lovelace, Ada', 'Bob Smith']);
    expect(valuesFor(fields, 'email')).toEqual(['ADA@Example.com', 'bob@x.io']);
    expect(valuesFor(fields, 'phone')).toEqual(['+44 20 7946 0958']);
  });
  it('splits multi-value skill cells', () => {
    expect(valuesFor(fields, 'skill')).toEqual(['Python', 'C++', 'k8s', 'JS']);
  });
  it('assembles current_company + title into an experience entry', () => {
    expect(valuesFor(fields, 'experience')).toContainEqual({
      company: 'Analytical Engines',
      title: 'Principal Engineer',
      start: null,
      end: 'present',
      summary: null,
    });
  });
  it('uses globally-unique record ids per row', () => {
    const ids = new Set(fields.map((f) => f.recordId));
    expect(ids).toEqual(new Set(['csv:recruiter.csv#0', 'csv:recruiter.csv#1']));
  });
  it('contributes nothing for an unrecognizable header', () => {
    expect(runAdapter({ type: 'csv', name: 'x.csv', content: 'foo,bar\n1,2' })).toEqual([]);
  });
});

describe('atsJsonAdapter (own field names)', () => {
  const source: RawSource = {
    type: 'ats_json',
    name: 'greenhouse.json',
    content: JSON.stringify({
      applicant: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        primary_email: 'ada@analyticalengine.io',
        alternate_emails: ['ada@example.com'],
        mobile: '+44 20 7946 0958',
        current_title: 'Principal Engineer',
        current_employer: 'Analytical Engines Ltd',
        location: { city: 'London', country: 'United Kingdom' },
        tags: ['Python', 'C++'],
        social_links: { github: 'github.com/ada' },
        work_history: [{ org: 'Analytical Engines Ltd', role: 'Principal Engineer', from: '2019-04', to: 'present' }],
        schools: [{ name: 'Univ of London', qualification: 'BSc', major: 'Mathematics', graduated: 1843 }],
      },
    }),
  };
  const fields = runAdapter(source);

  it('remaps ATS-specific keys to canonical slots', () => {
    expect(valuesFor(fields, 'full_name')).toEqual(['Ada Lovelace']);
    expect(valuesFor(fields, 'email')).toEqual(['ada@analyticalengine.io', 'ada@example.com']);
    expect(valuesFor(fields, 'headline')).toEqual(['Principal Engineer']);
    expect(valuesFor(fields, 'location.country')).toEqual(['United Kingdom']);
  });
  it('parses nested work history and schools', () => {
    expect(valuesFor(fields, 'experience')[0]).toMatchObject({ company: 'Analytical Engines Ltd', start: '2019-04' });
    expect(valuesFor(fields, 'education')[0]).toMatchObject({ institution: 'Univ of London', end_year: 1843 });
  });
  it('handles a top-level array of candidates', () => {
    const arr = runAdapter({ type: 'ats_json', name: 'a.json', content: JSON.stringify([{ name: 'A' }, { name: 'B' }]) });
    expect(valuesFor(arr, 'full_name')).toEqual(['A', 'B']);
    expect(new Set(arr.map((f) => f.recordId)).size).toBe(2);
  });
});

describe('githubAdapter', () => {
  const fields = runAdapter({
    type: 'github',
    name: 'ada',
    content: JSON.stringify({
      user: { login: 'ada', name: 'Ada Lovelace', bio: 'First programmer', location: 'London, UK', html_url: 'https://github.com/ada' },
      repos: [
        { name: 'engine', languages: { 'C++': 9000, Python: 3000 }, fork: false },
        { name: 'site', language: 'Python', fork: false },
        { name: 'forked', language: 'Go', fork: true },
      ],
    }),
  });
  it('extracts profile facts with api_field method', () => {
    expect(valuesFor(fields, 'full_name')).toEqual(['Ada Lovelace']);
    expect(valuesFor(fields, 'headline')).toEqual(['First programmer']);
    expect(fields.every((f) => f.method === 'api_field')).toBe(true);
  });
  it('derives distinct skills from non-fork repo languages (skips forks)', () => {
    expect(valuesFor(fields, 'skill')).toEqual(['C++', 'Python']);
  });
});

describe('notesAdapter (free text)', () => {
  const fields = runAdapter({
    type: 'notes',
    name: 'call.txt',
    content:
      'Call with Ada. Sharp.\nEmail: ada.lovelace@gmail.com\nPhone: +44 20 7946 0958\n' +
      'Currently Principal Engineer at Analytical Engines.\nSkills: Python, C++, mentoring\n12 years experience.',
  });
  it('reads labeled fields at higher confidence than the regex sweep', () => {
    const email = fields.find((f) => f.path === 'email');
    expect(email?.method).toBe('labeled_field');
    expect(valuesFor(fields, 'skill')).toEqual(['Python', 'C++', 'mentoring']);
    expect(valuesFor(fields, 'years_experience')).toEqual(['12']);
  });
  it('extracts a "<title> at <company>" experience without the "Currently" prefix', () => {
    expect(valuesFor(fields, 'experience')[0]).toMatchObject({ title: 'Principal Engineer', company: 'Analytical Engines' });
  });
});

describe('resumeAdapter', () => {
  const fields = runAdapter({
    type: 'resume',
    name: 'ada.pdf',
    content:
      'Ada Lovelace\nada@analyticalengine.io | +44 20 7946 0958 | github.com/ada\n\n' +
      'SKILLS\nLanguages: Python, C++, JavaScript\n\n' +
      'EXPERIENCE\nPrincipal Engineer at Analytical Engines (Jan 2019 - Present)\n\n' +
      'EDUCATION\nUniversity of London - BSc in Mathematics, 2015',
  });
  it('sweeps contact details', () => {
    expect(valuesFor(fields, 'email')).toContain('ada@analyticalengine.io');
    expect(valuesFor(fields, 'links.github')).toContain('github.com/ada');
  });
  it('parses the skills, experience and education sections', () => {
    expect(valuesFor(fields, 'skill')).toEqual(expect.arrayContaining(['Python', 'C++', 'JavaScript']));
    expect(valuesFor(fields, 'experience')[0]).toMatchObject({ company: 'Analytical Engines' });
    expect(valuesFor(fields, 'education')[0]).toMatchObject({ degree: 'BSc', end_year: 2015 });
  });
});

describe('robustness: garbage never crashes', () => {
  const garbage: RawSource[] = [
    { type: 'ats_json', name: 'broken.json', content: '{ not json' },
    { type: 'csv', name: 'empty.csv', content: '' },
    { type: 'github', name: 'x', content: 'null' },
    { type: 'notes', name: 'binary.txt', content: '\x00\x01\x02\xff' },
    { type: 'resume', name: 'r.pdf', content: '' },
  ];
  it('returns [] (or partial) for every malformed source, no throw', () => {
    for (const source of garbage) {
      expect(() => runAdapter(source)).not.toThrow();
      expect(Array.isArray(runAdapter(source))).toBe(true);
    }
  });
});
