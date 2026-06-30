/**
 * Canonical format patterns, defined once and reused by both the normalizers (which
 * produce these formats) and the Zod schemas (which verify them). Keeping a single
 * definition means the validator literally checks the contract the normalizer promises.
 */

/** E.164 phone number, e.g. "+919650762045". */
export const E164 = /^\+[1-9]\d{6,14}$/;

/** ISO-3166 alpha-2 country code, e.g. "IN". */
export const ISO_COUNTRY = /^[A-Z]{2}$/;

/** Year-month, e.g. "2026-07". */
export const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Year-month OR the sentinel "present" (used for an ongoing role's end date). */
export const YEAR_MONTH_OR_PRESENT = /^(?:\d{4}-(?:0[1-9]|1[0-2])|present)$/;

/** Four-digit year, e.g. "2027". */
export const YEAR = /^\d{4}$/;

/**
 * Pragmatic email pattern: one "@", no spaces, a dotted domain. Deliberately not
 * RFC-5322-exhaustive — that regex is famously unreadable and rejects nothing real
 * we care about. Good enough to guarantee a sane, normalized address.
 */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
