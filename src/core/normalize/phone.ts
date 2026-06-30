/**
 * Phone normalization to E.164 (e.g. "+919650762045").
 *
 * Policy (a direct application of "wrong-but-confident is worse than honestly-empty"):
 *  - A number written with an international prefix ("+…") is parsed as-is.
 *  - A number with no country code is ambiguous. We only resolve it if the caller
 *    supplies a `defaultCountry` hint; otherwise we return `null` rather than GUESS a
 *    country and emit a confidently-wrong number.
 *  - Anything libphonenumber cannot validate returns `null`.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import { ISO_COUNTRY } from '../patterns.js';

export function normalizePhone(input: unknown, defaultCountry?: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const hasIntlPrefix = trimmed.startsWith('+') || trimmed.startsWith('00');
  const country = normalizeCountryHint(defaultCountry);

  // Without an international prefix AND without a country hint, the number is
  // unresolvable. Refuse to guess.
  if (!hasIntlPrefix && country === undefined) return null;

  try {
    const parsed = hasIntlPrefix
      ? parsePhoneNumberFromString(trimmed.replace(/^00/, '+'))
      : parsePhoneNumberFromString(trimmed, country);
    if (parsed && parsed.isValid()) return parsed.number; // .number is E.164
  } catch {
    // fall through to null
  }
  return null;
}

function normalizeCountryHint(hint: string | undefined): CountryCode | undefined {
  if (hint === undefined) return undefined;
  const upper = hint.trim().toUpperCase();
  return ISO_COUNTRY.test(upper) ? (upper as CountryCode) : undefined;
}
