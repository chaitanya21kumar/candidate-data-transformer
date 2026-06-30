import { describe, it, expect } from 'vitest';
import { loadSources } from '../src/io/load.js';
import { extractAll } from '../src/core/adapters/index.js';
import { mergeToProfiles } from '../src/core/merge/index.js';

/**
 * Proves the résumé-PDF path works end to end: a real PDF fixture is read, its text is
 * extracted (with line breaks reconstructed from pdfjs EOL markers), and the resume
 * adapter parses both contact details and the SKILLS/EXPERIENCE/EDUCATION sections.
 */
describe('PDF résumé extraction (end-to-end)', () => {
  it('extracts contact details and sections from a real PDF', async () => {
    const { sources, skipped } = await loadSources(['tests/fixtures/sample-resume.pdf']);
    expect(skipped).toHaveLength(0);
    expect(sources[0]!.type).toBe('resume');

    const profile = mergeToProfiles(extractAll(sources))[0]!.profile;
    expect(profile.full_name).toBe('Grace Hopper');
    expect(profile.emails).toContain('grace.hopper@example.com');
    expect(profile.phones).toContain('+12025550178'); // E.164 from PDF text
    expect(profile.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Python', 'COBOL', 'Kubernetes', 'PostgreSQL']),
    );
    expect(profile.experience.length).toBeGreaterThanOrEqual(1);
    expect(profile.education[0]).toMatchObject({ institution: 'Yale University', end_year: 2012 });
  }, 20_000);
});
