/**
 * Write a generated dataset to samples/_generated/ (gitignored) so you can run the CLI
 * over a large directory. Usage: `npm run generate -- 2000` (defaults to 1000).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateSources } from './synthetic.js';

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 1000);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid candidate count: ${process.argv[2]}`);

  const dir = join('samples', '_generated');
  await mkdir(dir, { recursive: true });
  for (const source of generateSources(n)) {
    await writeFile(join(dir, source.name), source.content, 'utf8');
  }
  process.stdout.write(`✓ wrote ${n} candidates across 2 sources to ${dir}/\n`);
  process.stdout.write(`  try: npm run transform -- --inputs ${dir}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`generate failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
