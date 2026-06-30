#!/usr/bin/env node
/**
 * `transform` — the command-line surface.
 *
 *   transform --inputs <files|dirs...> [--config <config.json>] [--out <file>]
 *             [--default-country <ISO2>] [--compact] [--quiet]
 *
 * Reads one or more sources (files or directories), runs the pipeline, and writes the
 * canonical profiles (default) or a projected output (with --config) as JSON. Diagnostics
 * and a summary go to stderr so stdout stays clean, pipeable JSON.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import { transform } from './core/pipeline.js';
import { loadSources } from './io/load.js';

interface CliOptions {
  inputs?: string[];
  config?: string;
  out?: string;
  defaultCountry?: string;
  compact?: boolean;
  quiet?: boolean;
}

const program = new Command();

program
  .name('transform')
  .description('Multi-source candidate data transformer — messy sources to one canonical profile.')
  .requiredOption('-i, --inputs <paths...>', 'input files or directories')
  .option('-c, --config <file>', 'runtime output config (JSON); omit for the default schema')
  .option('-o, --out <file>', 'write JSON output to a file instead of stdout')
  .option('--default-country <ISO2>', 'ISO-3166 alpha-2 hint for phones without a country code')
  .option('--compact', 'compact JSON output (default is pretty-printed)')
  .option('--quiet', 'suppress the stderr summary and diagnostics')
  .showHelpAfterError()
  .action(run);

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

async function run(opts: CliOptions): Promise<void> {
  const { sources, skipped } = await loadSources(opts.inputs ?? []);

  let config: unknown;
  if (opts.config) {
    config = JSON.parse(await readFile(opts.config, 'utf8'));
  }

  const result = transform(sources, {
    ...(config !== undefined ? { config } : {}),
    ...(opts.defaultCountry ? { defaultCountry: opts.defaultCountry } : {}),
  });

  const data = result.mode === 'projected' ? result.records : result.profiles;
  const json = opts.compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);

  if (opts.out) {
    await writeFile(opts.out, json + '\n', 'utf8');
  } else {
    process.stdout.write(json + '\n');
  }

  if (!opts.quiet) printSummary(sources.length, skipped, result);
}

function printSummary(
  sourceCount: number,
  skipped: { path: string; reason: string }[],
  result: ReturnType<typeof transform>,
): void {
  const lines: string[] = [];
  lines.push(
    `✓ ${sourceCount} source(s) → ${result.count} profile(s) [${result.mode}${
      result.mode === 'projected' ? `, ${result.config.fields.length} fields` : ''
    }]`,
  );
  for (const s of skipped) lines.push(`  ⚠ skipped ${s.path}: ${s.reason}`);
  if (result.diagnostics.length > 0) {
    lines.push(`  diagnostics (${result.diagnostics.length}):`);
    for (const d of result.diagnostics) lines.push(`    • ${d}`);
  }
  process.stderr.write(lines.join('\n') + '\n');
}
