/**
 * The runtime output config — the "configurable output" twist.
 *
 * Two schemas live here:
 *  - `outputConfigSchema` validates the CONFIG itself (so a malformed config fails fast
 *    with a clear message).
 *  - `buildOutputSchema(config)` dynamically constructs a Zod schema for the PROJECTED
 *    OUTPUT from the config's field declarations. The projection is validated against it
 *    before returning — this is literally "validate the result against the requested
 *    schema", with the schema derived from the request.
 */
import { z } from 'zod';
import { provenanceSchema } from './canonical.js';

export const fieldTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'string[]',
  'number[]',
  'object',
  'object[]',
  'any',
]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

export const normalizeKindSchema = z.enum(['E164', 'canonical', 'date', 'country', 'lower', 'upper', 'trim']);
export type NormalizeKind = z.infer<typeof normalizeKindSchema>;

export const outputFieldSchema = z
  .object({
    /** Output key in the projected object. */
    path: z.string().min(1),
    /** Canonical path to read from; defaults to `path`. */
    from: z.string().min(1).optional(),
    type: fieldTypeSchema,
    required: z.boolean().optional(),
    normalize: normalizeKindSchema.optional(),
  })
  .strict();
export type OutputField = z.infer<typeof outputFieldSchema>;

export const outputConfigSchema = z
  .object({
    fields: z.array(outputFieldSchema).min(1),
    include_provenance: z.boolean().optional(),
    include_confidence: z.boolean().optional(),
    on_missing: z.enum(['null', 'omit', 'error']).optional(),
  })
  .strict();
export type OutputConfig = z.infer<typeof outputConfigSchema>;

/** Build the Zod schema the projected output must satisfy, from the config. */
export function buildOutputSchema(config: OutputConfig): z.ZodType {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of config.fields) {
    let base = zodForType(field.type);
    if (field.required) {
      shape[field.path] = base; // required & non-null
    } else {
      // Optional fields may be absent (on_missing: omit) or null (on_missing: null).
      shape[field.path] = base.nullable().optional();
    }
  }

  if (config.include_confidence) {
    shape['confidence'] = z.record(z.string(), z.union([z.number(), z.array(z.number())])).optional();
    shape['overall_confidence'] = z.number().min(0).max(1).optional();
  }
  if (config.include_provenance) {
    shape['provenance'] = z.array(provenanceSchema).optional();
  }

  // .strict() so an accidental extra key in the projection is caught.
  return z.object(shape).strict();
}

function zodForType(type: FieldType): z.ZodTypeAny {
  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'string[]':
      return z.array(z.string());
    case 'number[]':
      return z.array(z.number());
    case 'object':
      return z.record(z.string(), z.unknown());
    case 'object[]':
      return z.array(z.record(z.string(), z.unknown()));
    case 'any':
      return z.unknown();
  }
}
