import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalProfileSchema } from '../src/core/schema/canonical.js';
import { buildOutputSchema } from '../src/core/schema/config.js';
import { parseConfig } from '../src/core/projection/index.js';

const load = (p: string): unknown[] => JSON.parse(readFileSync(p, 'utf8'));

/**
 * Guards the assignment's core promise: the committed outputs are schema-valid JSON for
 * the default schema AND for each custom config. If a future change makes a committed
 * artifact violate its schema, this fails (alongside the CI determinism gate).
 */
describe('committed outputs are schema-valid', () => {
  it.each(['outputs/ada.default.json', 'outputs/edge.default.json'])(
    'default output %s validates against the canonical schema',
    (file) => {
      const profiles = load(file);
      expect(profiles.length).toBeGreaterThan(0);
      for (const profile of profiles) expect(() => canonicalProfileSchema.parse(profile)).not.toThrow();
    },
  );

  it.each([
    ['outputs/ada.recruiter-card.json', 'configs/recruiter-card.json'],
    ['outputs/ada.ats-sync.json', 'configs/ats-sync.json'],
    ['outputs/ada.contact-min.json', 'configs/contact-min.json'],
  ])('projected output %s validates against the schema built from %s', (outFile, configFile) => {
    const schema = buildOutputSchema(parseConfig(JSON.parse(readFileSync(configFile, 'utf8'))));
    const records = load(outFile);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) expect(() => schema.parse(record)).not.toThrow();
  });
});
