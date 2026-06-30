/**
 * Adapter registry: maps a source type to its adapter and guarantees that no adapter
 * can ever crash the pipeline. Even though each adapter is internally defensive, the
 * registry wraps the call as a second safety net — a malformed source yields `[]`.
 */
import type { ExtractedField, RawSource, SourceType } from '../types.js';
import { csvAdapter } from './csv.js';
import { atsJsonAdapter } from './atsJson.js';
import { githubAdapter } from './github.js';
import { notesAdapter } from './notes.js';
import { resumeAdapter } from './resume.js';

type Adapter = (source: RawSource) => ExtractedField[];

const REGISTRY: Record<SourceType, Adapter> = {
  csv: csvAdapter,
  ats_json: atsJsonAdapter,
  github: githubAdapter,
  notes: notesAdapter,
  resume: resumeAdapter,
  // LinkedIn has no public API and scraping violates its ToS, so a `linkedin` source is
  // a user-provided profile export parsed as free text (see DESIGN_NOTES). LinkedIn URLs
  // found in other sources are still captured into links.linkedin.
  linkedin: notesAdapter,
};

export function runAdapter(source: RawSource): ExtractedField[] {
  const adapter = REGISTRY[source.type];
  if (!adapter) return [];
  try {
    return adapter(source);
  } catch {
    return [];
  }
}

/** Run every source through its adapter and flatten into one claim list. */
export function extractAll(sources: readonly RawSource[]): ExtractedField[] {
  return sources.flatMap(runAdapter);
}

export { csvAdapter, atsJsonAdapter, githubAdapter, notesAdapter, resumeAdapter };
