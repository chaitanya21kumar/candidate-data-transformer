/**
 * Deterministic, dependency-free hashing used to mint stable `candidate_id`s.
 *
 * We use FNV-1a (64-bit) rather than SHA-256 on purpose: the id only needs to be
 * deterministic and collision-resistant *at our scale* (thousands–millions of
 * candidates), not cryptographically secure. FNV-1a is tiny, synchronous, and
 * isomorphic — it runs identically in Node and the browser with no native `crypto`
 * dependency, which keeps the core engine pure. (If we ever needed a cryptographic
 * guarantee we'd switch to SHA-256 via WebCrypto/`node:crypto`.)
 */

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK_64 = (1n << 64n) - 1n;

/** FNV-1a 64-bit digest of a UTF-8 string, as 16 lowercase hex chars. */
export function fnv1a64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Deterministic candidate id derived from the strongest stable identifier available.
 * The same person always produces the same id across runs, regardless of source order.
 */
export function candidateId(seed: string): string {
  return `cand_${fnv1a64(seed.trim().toLowerCase())}`;
}
