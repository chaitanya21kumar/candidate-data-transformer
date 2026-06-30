/**
 * Scale benchmark: confirm the pipeline is comfortable on thousands of candidates and
 * that entity resolution stays correct at volume. Run with `npm run bench`.
 *
 * Each candidate appears in two sources, so the pipeline ingests 2N records and must
 * resolve them to exactly N profiles.
 */
import { performance } from 'node:perf_hooks';
import { transform } from '../src/core/pipeline.js';
import { generateSources } from './synthetic.js';

const SIZES = [1_000, 5_000, 10_000, 25_000];

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function main(): void {
  process.stdout.write('Scale benchmark — 2 sources, 2N input records → N resolved profiles\n');
  process.stdout.write('─'.repeat(72) + '\n');
  process.stdout.write(`${'candidates'.padEnd(12)}${'records'.padEnd(12)}${'time'.padEnd(12)}${'throughput'}\n`);

  for (const n of SIZES) {
    const sources = generateSources(n);
    const records = n * 2;

    // Warm-up so the first run's JIT cost is not attributed to the smallest size.
    transform(sources);

    const t0 = performance.now();
    const result = transform(sources);
    const ms = performance.now() - t0;

    if (result.count !== n) {
      throw new Error(`entity resolution incorrect: expected ${n} profiles, got ${result.count}`);
    }

    const perSec = Math.round(records / (ms / 1000));
    process.stdout.write(
      `${fmt(n).padEnd(12)}${fmt(records).padEnd(12)}${`${ms.toFixed(0)} ms`.padEnd(12)}${fmt(perSec)} records/s\n`,
    );
  }
  process.stdout.write('─'.repeat(72) + '\n');
}

main();
