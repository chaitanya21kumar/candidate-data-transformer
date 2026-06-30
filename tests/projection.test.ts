import { describe, it, expect } from 'vitest';
import { extractAll } from '../src/core/adapters/index.js';
import { mergeToProfiles } from '../src/core/merge/index.js';
import { project, parseConfig, ProjectionError, resolvePath } from '../src/core/projection/index.js';
import type { RawSource, ResolvedProfile } from '../src/core/types.js';

// A single, well-linked profile to project from.
function adaProfile(): ResolvedProfile {
  const sources: RawSource[] = [
    {
      type: 'csv',
      name: 'r.csv',
      content: 'Name,Email,Mobile,Current Company,Title,Skills\nAda Lovelace,ada@x.io,+44 20 7946 0958,Analytical Engines,Principal Engineer,"js; postgres; k8s"\n',
    },
  ];
  return mergeToProfiles(extractAll(sources))[0]!;
}

describe('resolvePath', () => {
  const obj = { a: { b: 'x' }, arr: [{ n: 1 }, { n: 2 }], emails: ['p@x.io', 's@y.io'] };
  it('resolves dotted, indexed, and mapped paths', () => {
    expect(resolvePath(obj, 'a.b').value).toBe('x');
    expect(resolvePath(obj, 'emails[0]').value).toBe('p@x.io');
    expect(resolvePath(obj, 'arr[].n')).toMatchObject({ value: [1, 2], hadMap: true });
  });
  it('returns undefined for unresolved paths', () => {
    expect(resolvePath(obj, 'a.missing').value).toBeUndefined();
    expect(resolvePath(obj, 'emails[5]').value).toBeUndefined();
  });
});

describe('project (the configurable output)', () => {
  const resolved = adaProfile();

  it("matches the assignment's example config (remap + normalize + confidence)", () => {
    const config = parseConfig({
      fields: [
        { path: 'full_name', type: 'string', required: true },
        { path: 'primary_email', from: 'emails[0]', type: 'string', required: true },
        { path: 'phone', from: 'phones[0]', type: 'string', normalize: 'E164' },
        { path: 'skills', from: 'skills[].name', type: 'string[]', normalize: 'canonical' },
      ],
      include_confidence: true,
      on_missing: 'null',
    });
    const out = project(resolved, config);
    expect(out['full_name']).toBe('Ada Lovelace');
    expect(out['primary_email']).toBe('ada@x.io');
    expect(out['phone']).toBe('+442079460958');
    expect(out['skills']).toEqual(['JavaScript', 'Kubernetes', 'PostgreSQL']);
    expect(out['overall_confidence']).toBeTypeOf('number');
    expect((out['confidence'] as Record<string, unknown>)['skills']).toBeInstanceOf(Array);
  });

  it('honors on_missing = null | omit | error', () => {
    const base = [{ path: 'full_name', type: 'string' as const }, { path: 'tw', from: 'links.other[0]', type: 'string' as const }];
    expect(project(resolved, parseConfig({ fields: base, on_missing: 'null' }))).toHaveProperty('tw', null);
    expect(project(resolved, parseConfig({ fields: base, on_missing: 'omit' }))).not.toHaveProperty('tw');
    expect(() => project(resolved, parseConfig({ fields: base, on_missing: 'error' }))).toThrow(ProjectionError);
  });

  it('validates the projection against the schema built from the config', () => {
    // years_experience is absent for this profile; marked required number -> must fail.
    const config = parseConfig({ fields: [{ path: 'years', from: 'years_experience', type: 'number', required: true }], on_missing: 'null' });
    expect(() => project(resolved, config)).toThrow(/schema validation/);
  });

  it('includes only the provenance relevant to the projected subset', () => {
    const config = parseConfig({
      fields: [{ path: 'primary_email', from: 'emails[0]', type: 'string' }],
      include_provenance: true,
    });
    const out = project(resolved, config) as { provenance: { field: string }[] };
    expect(out.provenance.length).toBeGreaterThan(0);
    expect(out.provenance.every((p) => p.field === 'emails[0]')).toBe(true);
  });

  it('omits confidence for derived fields that have none (no misleading zero)', () => {
    const config = parseConfig({
      fields: [
        { path: 'candidate_id', type: 'string' }, // derived — no tracked confidence
        { path: 'full_name', type: 'string' }, // has confidence
      ],
      include_confidence: true,
    });
    const out = project(resolved, config) as { confidence: Record<string, unknown> };
    expect(out.confidence).toHaveProperty('full_name');
    expect(out.confidence).not.toHaveProperty('candidate_id');
  });

  it('applies trim/lower/upper normalizers', () => {
    const config = parseConfig({ fields: [{ path: 'name_lc', from: 'full_name', type: 'string', normalize: 'lower' }] });
    expect(project(resolved, config)['name_lc']).toBe('ada lovelace');
  });
});

describe('config validation', () => {
  it('rejects a malformed config with a clear error', () => {
    expect(() => parseConfig({ fields: [] })).toThrow(ProjectionError);
    expect(() => parseConfig({ fields: [{ path: 'x', type: 'not-a-type' }] })).toThrow(ProjectionError);
    expect(() => parseConfig({ fields: [{ path: 'x', type: 'string', bogus: true }] })).toThrow(ProjectionError);
  });
});
