/**
 * Public surface of the pure engine. Importable from both the CLI and the browser UI
 * (no Node-only dependencies are reachable from here).
 */
export type {
  RawSource,
  SourceType,
  ExtractedField,
  ExtractionMethod,
  CanonicalProfile,
  CanonicalSkill,
  CanonicalExperience,
  CanonicalEducation,
  ProvenanceEntry,
  ResolvedProfile,
} from './types.js';

export { transform, resolveProfiles, validateDefault } from './pipeline.js';
export type { PipelineOptions, PipelineResult, DefaultResult, ProjectedResult } from './pipeline.js';

export { extractAll, runAdapter } from './adapters/index.js';
export { mergeToProfiles } from './merge/index.js';
export { project, projectAll, parseConfig, ProjectionError } from './projection/index.js';

export { canonicalProfileSchema } from './schema/canonical.js';
export { outputConfigSchema, buildOutputSchema } from './schema/config.js';
export type { OutputConfig, OutputField } from './schema/config.js';

export { SOURCE_TRUST, METHOD_TRUST } from './confidence.js';
