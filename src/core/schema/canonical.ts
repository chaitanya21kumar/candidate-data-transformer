/**
 * Zod schema for the canonical profile — i.e. the assignment's default output schema.
 *
 * This is the contract the pipeline validates against before returning the default
 * output. The regex refinements double as an internal correctness check: if a
 * normalizer ever lets a non-E.164 phone or a non-alpha-2 country through, validation
 * fails loudly here rather than silently shipping a bad value.
 */
import { z } from 'zod';
import { E164, EMAIL, ISO_COUNTRY, YEAR_MONTH, YEAR_MONTH_OR_PRESENT } from '../patterns.js';

const confidence = z.number().min(0).max(1);
const sourceId = z.string().min(1); // "<type>:<name>"

export const extractionMethodSchema = z.enum([
  'structured_field',
  'api_field',
  'labeled_field',
  'regex_extraction',
  'heuristic',
]);

export const locationSchema = z.object({
  city: z.string().min(1).nullable(),
  region: z.string().min(1).nullable(),
  country: z.string().regex(ISO_COUNTRY, 'country must be ISO-3166 alpha-2').nullable(),
});

export const linksSchema = z.object({
  linkedin: z.string().url().nullable(),
  github: z.string().url().nullable(),
  portfolio: z.string().url().nullable(),
  other: z.array(z.string().url()),
});

export const skillSchema = z.object({
  name: z.string().min(1),
  confidence,
  sources: z.array(sourceId),
});

export const experienceSchema = z.object({
  company: z.string().min(1).nullable(),
  title: z.string().min(1).nullable(),
  start: z.string().regex(YEAR_MONTH, 'start must be YYYY-MM').nullable(),
  end: z.string().regex(YEAR_MONTH_OR_PRESENT, 'end must be YYYY-MM or "present"').nullable(),
  summary: z.string().min(1).nullable(),
});

export const educationSchema = z.object({
  institution: z.string().min(1).nullable(),
  degree: z.string().min(1).nullable(),
  field: z.string().min(1).nullable(),
  end_year: z.number().int().gte(1900).lte(2100).nullable(),
});

export const provenanceSchema = z.object({
  field: z.string().min(1),
  source: sourceId,
  method: extractionMethodSchema,
});

export const canonicalProfileSchema = z.object({
  candidate_id: z.string().min(1),
  full_name: z.string().min(1).nullable(),
  emails: z.array(z.string().regex(EMAIL, 'invalid email')),
  phones: z.array(z.string().regex(E164, 'phone must be E.164')),
  location: locationSchema,
  links: linksSchema,
  headline: z.string().min(1).nullable(),
  years_experience: z.number().gte(0).lte(80).nullable(),
  skills: z.array(skillSchema),
  experience: z.array(experienceSchema),
  education: z.array(educationSchema),
  provenance: z.array(provenanceSchema),
  overall_confidence: confidence,
});

/** Inferred type — kept structurally identical to {@link CanonicalProfile} in types.ts. */
export type CanonicalProfileParsed = z.infer<typeof canonicalProfileSchema>;

// --- Compile-time guarantee the Zod schema and the hand-written type never drift. ---
import type { CanonicalProfile } from '../types.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// If this line errors, the schema and the type have diverged — fix one of them.
export type _SchemaMatchesType = Expect<Equal<CanonicalProfileParsed, CanonicalProfile>>;
