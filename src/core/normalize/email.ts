/**
 * Email normalization.
 *
 * Returns a lowercased, trimmed address, or `null` when the input is not a sane email
 * (honestly-empty beats a wrong value). Lowercasing the whole address is technically
 * stricter than RFC 5321 (which allows a case-sensitive local part), but every real
 * mail system treats addresses case-insensitively and it is what makes cross-source
 * de-duplication correct — so we do it deliberately and document it.
 */
import { EMAIL } from '../patterns.js';

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  if (value.startsWith('mailto:')) value = value.slice('mailto:'.length);
  // Strip a single layer of surrounding angle brackets: "<a@b.com>".
  value = value.replace(/^<(.*)>$/, '$1').trim();
  if (!EMAIL.test(value)) return null;
  return value;
}
