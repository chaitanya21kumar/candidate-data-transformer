/**
 * Deterministic, locale-independent string comparison (Unicode code-unit order).
 *
 * Used everywhere the pipeline sorts. `String.prototype.localeCompare` is intentionally
 * avoided: its ordering depends on the host's ICU locale (e.g. case-folding differs
 * between en-US and the POSIX/C locale), which would make output non-deterministic across
 * machines and could fail the CI determinism gate even when the logic is correct.
 */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
