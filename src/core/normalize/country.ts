/**
 * Country normalization to ISO-3166-1 alpha-2 ("IN", "US", "GB").
 *
 * Strategy: a small curated alias map handles the informal spellings real data is full
 * of ("UK", "England", "USA", "UAE", "South Korea"), and `i18n-iso-countries` handles
 * the long tail of official names and alpha-3 codes. Unrecognized input returns `null`
 * — we never guess a country.
 */
import * as countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import { ISO_COUNTRY } from '../patterns.js';

countries.registerLocale(en as Parameters<typeof countries.registerLocale>[0]);

/** Informal spellings the library does not resolve on its own. */
const ALIASES: Record<string, string> = {
  uk: 'GB',
  'u.k.': 'GB',
  'u.k': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  'u.s': 'US',
  america: 'US',
  uae: 'AE',
  'u.a.e.': 'AE',
  'south korea': 'KR',
  'korea, south': 'KR',
  'north korea': 'KP',
  russia: 'RU',
  bharat: 'IN',
};

export function normalizeCountry(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const upper = trimmed.toUpperCase();

  // Already an alpha-2 code.
  if (ISO_COUNTRY.test(upper) && countries.isValid(upper)) return upper;

  // Alpha-3 code.
  if (/^[A-Z]{3}$/.test(upper)) {
    const a2 = countries.alpha3ToAlpha2(upper);
    if (a2) return a2;
  }

  // Curated informal aliases.
  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  // Full / official names via the library.
  const code = countries.getAlpha2Code(trimmed, 'en');
  if (code && ISO_COUNTRY.test(code)) return code;

  return null;
}
