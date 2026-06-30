/**
 * Person-name normalization.
 *
 * Names are notoriously hard to validate, so we are conservative: we only tidy
 * whitespace and strip wrapping punctuation, and we never re-case (re-casing breaks
 * "McDonald", "van der Berg", "O'Brien"). The ONE exception is an all-caps input
 * ("ADA LOVELACE"), which we title-case for readability since CSV exports frequently
 * shout names.
 *
 * `nameKey` produces a comparison key for entity resolution — aggressively folded
 * (lowercased, de-punctuated, whitespace-collapsed) so "Ada Lovelace" and
 * "ada  lovelace," match, while keeping the displayed name pristine.
 */

export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  // Drop wrapping quotes and stray leading/trailing commas/semicolons.
  value = value.replace(/^["'`]+|["'`]+$/g, '').replace(/^[,;\s]+|[,;\s]+$/g, '');
  value = value.replace(/\s+/g, ' ').trim();
  if (value.length === 0) return null;
  // Must contain at least one letter and no obvious non-name tokens (emails, urls).
  if (!/\p{L}/u.test(value)) return null;
  if (value.includes('@') || /https?:\/\//i.test(value)) return null;
  // Re-case only if the input is entirely upper-case (common in CSV dumps).
  if (value === value.toUpperCase()) value = toTitleCase(value);
  return value;
}

/** Folded comparison key for matching; not for display. Empty string if not a name. */
export function nameKey(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .map((word) =>
      // Preserve hyphenated and apostrophed parts: "jean-luc", "o'brien".
      word.replace(/(^|[-'])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()),
    )
    .join(' ');
}
