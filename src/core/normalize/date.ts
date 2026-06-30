/**
 * Date normalization to YYYY-MM (the canonical month format for experience entries),
 * plus helpers for ongoing-role end dates and education years.
 *
 * Guiding rule: never invent precision we do not have. A year-only input ("2021") is
 * NOT silently promoted to "2021-01" — `normalizeMonth` returns `null` because the
 * month is unknown. Year-only information is captured where it legitimately belongs:
 * `education.end_year` via `extractYear`.
 */

const MONTHS: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

const ONGOING = new Set(['present', 'current', 'now', 'ongoing', 'till date', 'to date']);

/** Normalize a single month value to "YYYY-MM", or `null` if month precision is absent. */
export function normalizeMonth(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value.length === 0) return null;

  // ISO-ish: 2024-03 or 2024-03-15 or 2024/03
  const iso = value.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (iso && iso[1] && iso[2]) return buildMonth(iso[1], iso[2]);

  // US-ish: 03/2024 or 3-2024
  const us = value.match(/^(\d{1,2})[-/](\d{4})$/);
  if (us && us[1] && us[2]) return buildMonth(us[2], us[1]);

  // Named month: "march 2024", "mar 2024", "mar. 2024", "march, 2024"
  const named = value.match(/^([a-z]+)\.?,?\s+(\d{4})$/);
  if (named && named[1] && named[2]) {
    const mm = MONTHS[named[1]];
    if (mm) return `${named[2]}-${mm}`;
  }

  return null; // year-only or unparseable → no honest month
}

/** Like {@link normalizeMonth} but maps ongoing markers to the sentinel "present". */
export function normalizeEndDate(input: unknown): string | null {
  if (typeof input === 'string' && ONGOING.has(input.trim().toLowerCase())) return 'present';
  return normalizeMonth(input);
}

/** Extract a plausible 4-digit year (1900–2100) for education end-year, else `null`. */
export function extractYear(input: unknown): number | null {
  if (typeof input === 'number' && Number.isInteger(input)) {
    return input >= 1900 && input <= 2100 ? input : null;
  }
  if (typeof input !== 'string') return null;
  const match = input.match(/\b(19\d{2}|20\d{2}|2100)\b/);
  if (!match || !match[1]) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2100 ? year : null;
}

function buildMonth(year: string, month: string): string | null {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return `${year}-${String(m).padStart(2, '0')}`;
}
