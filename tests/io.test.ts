import { describe, it, expect } from 'vitest';
import { loadSources } from '../src/io/load.js';

describe('loadSources (source-type detection + robustness)', () => {
  it('detects the right type for each file in samples/ada', async () => {
    const { sources, skipped } = await loadSources(['samples/ada']);
    expect(skipped).toHaveLength(0);
    const byName = Object.fromEntries(sources.map((s) => [s.name, s.type]));
    expect(byName['recruiter.csv']).toBe('csv');
    expect(byName['greenhouse.ats.json']).toBe('ats_json');
    expect(byName['github.json']).toBe('github'); // distinguished by {user,repos}
    expect(byName['notes.txt']).toBe('notes');
    expect(byName['resume.txt']).toBe('resume'); // filename hint
  });

  it('loads a directory recursively and orders sources deterministically', async () => {
    const a = await loadSources(['samples/edge']);
    const b = await loadSources(['samples/edge']);
    expect(a.sources.map((s) => s.name)).toEqual(b.sources.map((s) => s.name)); // stable order
    expect(a.sources.length).toBeGreaterThanOrEqual(3);
  });

  it('reports a missing path as skipped rather than throwing', async () => {
    const { sources, skipped } = await loadSources(['samples/does-not-exist.csv']);
    expect(sources).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.path).toContain('does-not-exist');
  });
});
