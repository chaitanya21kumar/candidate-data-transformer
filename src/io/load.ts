/**
 * Node I/O layer: turn file/directory paths into the pure engine's {@link RawSource}s.
 *
 * Source type is inferred from extension, content and filename hints. A directory is
 * walked recursively (handy for batch/scale runs). PDFs are converted to text via the
 * lazy pdfjs extractor. Unreadable or unsupported files are skipped with a reason rather
 * than aborting the run.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import type { RawSource, SourceType } from '../core/types.js';
import { cmp } from '../core/order.js';
import { extractPdfText } from './pdf.js';

export interface LoadResult {
  sources: RawSource[];
  skipped: { path: string; reason: string }[];
}

export async function loadSources(paths: readonly string[]): Promise<LoadResult> {
  const files = await expandPaths(paths);
  const sources: RawSource[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const path of files) {
    try {
      const ext = extname(path).toLowerCase();
      const name = basename(path);

      if (ext === '.pdf') {
        const data = await readFile(path);
        const text = await extractPdfText(new Uint8Array(data));
        sources.push({ type: 'resume', name, content: text });
        continue;
      }
      if (ext === '.docx') {
        skipped.push({ path, reason: 'DOCX not supported in this build — export to PDF or .txt' });
        continue;
      }

      const raw = await readFile(path, 'utf8');
      const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip a leading BOM
      const type = detectType(name, ext, content);
      if (type === null) {
        skipped.push({ path, reason: `unrecognized source type for "${ext || name}"` });
        continue;
      }
      sources.push({ type, name, content });
    } catch (err) {
      skipped.push({ path, reason: err instanceof Error ? err.message : 'read error' });
    }
  }

  // Deterministic ordering by name (entity resolution is order-independent anyway).
  sources.sort((a, b) => cmp(a.name, b.name));
  return { sources, skipped };
}

function detectType(name: string, ext: string, content: string): SourceType | null {
  const lower = name.toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.json') return looksLikeGithub(content) ? 'github' : 'ats_json';
  if (ext === '.txt' || ext === '.md' || ext === '') {
    if (lower.includes('resume') || lower.includes('cv')) return 'resume';
    if (lower.includes('github')) return 'github';
    if (lower.includes('linkedin')) return 'linkedin';
    return 'notes';
  }
  return null;
}

function looksLikeGithub(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      ('user' in parsed || 'repos' in parsed)
    );
  } catch {
    return false;
  }
}

async function expandPaths(paths: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    try {
      const info = await stat(path);
      if (info.isDirectory()) out.push(...(await walk(path)));
      else out.push(path);
    } catch {
      // Missing path is reported later as a skipped read.
      out.push(path);
    }
  }
  return out;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
