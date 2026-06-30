/**
 * Deterministic synthetic data generator for the scale benchmark and demos.
 *
 * Produces N candidates, each represented in BOTH a recruiter CSV and an ATS JSON blob
 * that share an email (and a differently-formatted phone), so entity resolution must
 * collapse 2N records into N profiles. No randomness — index-driven, fully reproducible.
 */
import type { RawSource } from '../src/core/types.js';

const FIRST = ['Ada', 'Grace', 'Linus', 'Alan', 'Katherine', 'Donald', 'Barbara', 'Edsger', 'Margaret', 'Tim'];
const LAST = ['Lovelace', 'Hopper', 'Torvalds', 'Turing', 'Johnson', 'Knuth', 'Liskov', 'Dijkstra', 'Hamilton', 'Lee'];
const COMPANIES = ['Analytical Engines', 'Babbage Systems', 'Acme', 'Globex', 'Initech', 'Hooli', 'Umbrella', 'Soylent'];
const COUNTRIES = ['United Kingdom', 'United States', 'India', 'Germany', 'Canada', 'Australia'];
const SKILLS = ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Kubernetes', 'PostgreSQL', 'React', 'Docker', 'AWS', 'GraphQL', 'C++'];
const TITLES = ['Software Engineer', 'Senior Engineer', 'Staff Engineer', 'Principal Engineer', 'Engineering Manager'];

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

interface Candidate {
  name: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  country: string;
  csvSkills: string[];
  atsSkills: string[];
}

function candidate(i: number): Candidate {
  const first = FIRST[i % FIRST.length]!;
  const last = LAST[(i * 7) % LAST.length]!;
  const s = (k: number) => SKILLS[(i + k) % SKILLS.length]!;
  return {
    name: `${first} ${last}`,
    email: `${first}.${last}.${i}@example.com`.toLowerCase(),
    // Valid Indian mobile (starts 9), unique per candidate.
    phone: `+9198${pad(i % 100000000, 8)}`,
    company: COMPANIES[i % COMPANIES.length]!,
    title: TITLES[i % TITLES.length]!,
    country: COUNTRIES[i % COUNTRIES.length]!,
    csvSkills: [s(0), s(3), 'Git'],
    atsSkills: [s(3), s(7), 'Git'], // overlaps so confidence corroborates
  };
}

/** N candidates as two sources (a CSV and an ATS JSON array) that resolve to N people. */
export function generateSources(n: number): RawSource[] {
  const csvRows = ['Name,Email,Phone,Current Company,Title,Country,Skills'];
  const atsRecords: unknown[] = [];

  for (let i = 0; i < n; i++) {
    const c = candidate(i);
    csvRows.push(`${c.name},${c.email},${c.phone},${c.company},${c.title},${c.country},"${c.csvSkills.join('; ')}"`);
    atsRecords.push({
      name: c.name,
      primary_email: c.email,
      // Same number, spaced — exercises phone normalization + corroboration.
      mobile: c.phone.replace(/^(\+\d\d)(\d\d)(\d{4})(\d{4})$/, '$1 $2 $3 $4'),
      current_title: c.title,
      current_employer: c.company,
      location: { country: c.country },
      tags: c.atsSkills,
      work_history: [{ org: c.company, role: c.title, from: '2020-01', to: 'present' }],
    });
  }

  return [
    { type: 'csv', name: 'generated_recruiter.csv', content: csvRows.join('\n') + '\n' },
    { type: 'ats_json', name: 'generated_ats.json', content: JSON.stringify(atsRecords) },
  ];
}
