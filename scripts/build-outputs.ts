/**
 * Regenerate every committed artifact under outputs/ from the samples and configs.
 * Run with `npm run build:outputs`. Because the pipeline is deterministic, re-running
 * this produces byte-identical files (used by the determinism check and CI).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSources } from '../src/io/load.js';
import { transform } from '../src/core/pipeline.js';

interface Job {
  name: string;
  inputs: string[];
  config?: string;
  defaultCountry?: string;
}

const JOBS: Job[] = [
  { name: 'ada.default', inputs: ['samples/ada'] },
  { name: 'ada.recruiter-card', inputs: ['samples/ada'], config: 'configs/recruiter-card.json' },
  { name: 'ada.ats-sync', inputs: ['samples/ada'], config: 'configs/ats-sync.json' },
  { name: 'ada.contact-min', inputs: ['samples/ada'], config: 'configs/contact-min.json' },
  { name: 'edge.default', inputs: ['samples/edge'] },
];

const OUT_DIR = 'outputs';

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const job of JOBS) {
    const { sources, skipped } = await loadSources(job.inputs);
    const config = job.config ? JSON.parse(await readFile(job.config, 'utf8')) : undefined;
    const result = transform(sources, {
      ...(config !== undefined ? { config } : {}),
      ...(job.defaultCountry ? { defaultCountry: job.defaultCountry } : {}),
    });
    const data = result.mode === 'projected' ? result.records : result.profiles;
    const file = join(OUT_DIR, `${job.name}.json`);
    await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    process.stdout.write(
      `✓ ${file}  (${sources.length} sources, ${skipped.length} skipped → ${result.count} ${result.mode})\n`,
    );
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`build-outputs failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
