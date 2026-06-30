/**
 * URL normalization and classification.
 *
 *  - `normalizeUrl` returns a canonical absolute URL (https-prefixed, lowercased host,
 *    no trailing slash, tracking-free) or `null` if it cannot be parsed.
 *  - `classifyUrl` routes a bare URL to the right canonical link slot so adapters can
 *    file an unlabeled link found in free text.
 *  - `githubUsername` extracts the profile handle, used both as a link and as a strong
 *    entity-resolution match key.
 */

export type LinkKind = 'linkedin' | 'github' | 'portfolio' | 'other';

export function normalizeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (raw.length === 0) return null;
  // Add a scheme if the author wrote a bare domain ("github.com/x").
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null; // reject "https://localhost"-style noise

  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.search = ''; // strip tracking/query params for stable profile URLs
  let out = url.toString();
  if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
  // Drop a bare trailing "/" on a host-only URL too, for cleanliness.
  if (url.pathname === '/' ) out = `${url.protocol}//${url.hostname}`;
  return out;
}

export function classifyUrl(input: unknown): LinkKind | null {
  const url = normalizeUrl(input);
  if (url === null) return null;
  const host = new URL(url).hostname;
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  // GitHub Pages and similar personal sites read as a portfolio.
  if (host.endsWith('.github.io')) return 'portfolio';
  return 'other';
}

/** Lowercased GitHub handle from a profile URL, or `null`. */
export function githubUsername(input: unknown): string | null {
  const url = normalizeUrl(input);
  if (url === null) return null;
  const u = new URL(url);
  if (u.hostname !== 'github.com') return null;
  const segments = u.pathname.split('/').filter(Boolean);
  const handle = segments[0];
  if (handle === undefined) return null;
  // Skip GitHub's own reserved routes that are not user profiles.
  const reserved = new Set(['orgs', 'enterprises', 'sponsors', 'features', 'about', 'pricing']);
  if (reserved.has(handle.toLowerCase())) return null;
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(handle)) return null;
  return handle.toLowerCase();
}
