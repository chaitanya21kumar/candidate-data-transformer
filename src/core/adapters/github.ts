/**
 * GitHub adapter.
 *
 * Consumes a GitHub API payload shaped as `{ user, repos }` (the public REST objects),
 * supplied either by a live fetch (see src/io/github.ts) or a captured fixture. Using a
 * fixture for the sample/CI runs keeps the pipeline deterministic and offline-friendly
 * while the same adapter handles live data unchanged.
 *
 * It contributes GitHub-native facts (name, bio -> headline, profile/portfolio links,
 * company, location) and derives skills from the languages across non-fork repos.
 */
import type { ExperienceInput, ExtractedField, RawSource } from '../types.js';
import { isBlank, makeField, stripBom } from './util.js';

interface GithubUser {
  login?: string;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  blog?: string | null;
  location?: string | null;
  html_url?: string | null;
  twitter_username?: string | null;
}

interface GithubRepo {
  name?: string;
  language?: string | null;
  languages?: Record<string, number> | null;
  fork?: boolean;
}

export function githubAdapter(source: RawSource): ExtractedField[] {
  const fields: ExtractedField[] = [];
  try {
    const parsed: unknown = JSON.parse(stripBom(source.content));
    const { user, repos } = unwrap(parsed);
    if (!user) return fields;

    const recordId = `${source.type}:${source.name}#0`;
    const add = (path: Parameters<typeof makeField>[0]['path'], value: unknown) =>
      fields.push(makeField({ recordId, source, path, value, method: 'api_field' }));

    if (user.name && !isBlank(user.name)) add('full_name', user.name);
    if (user.bio && !isBlank(user.bio)) add('headline', user.bio);

    const profile = user.html_url ?? (user.login ? `https://github.com/${user.login}` : null);
    if (profile) add('links.github', profile);
    if (user.blog && !isBlank(user.blog)) add('links.portfolio', user.blog);
    if (user.twitter_username && !isBlank(user.twitter_username))
      add('links.other', `https://twitter.com/${user.twitter_username}`);

    if (user.location && !isBlank(user.location)) {
      const parts = user.location.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        add('location.city', parts[0]);
        add('location.country', parts[parts.length - 1]);
      } else if (parts.length === 1) {
        add('location.city', parts[0]);
      }
    }

    if (user.company && !isBlank(user.company)) {
      const entry: ExperienceInput = {
        company: user.company.replace(/^@/, '').trim(),
        title: null,
        start: null,
        end: 'present',
        summary: null,
      };
      add('experience', entry);
    }

    for (const language of aggregateLanguages(repos)) add('skill', language);
  } catch {
    // Malformed payload contributes nothing.
  }
  return fields;
}

function unwrap(parsed: unknown): { user: GithubUser | null; repos: GithubRepo[] } {
  if (typeof parsed !== 'object' || parsed === null) return { user: null, repos: [] };
  const obj = parsed as Record<string, unknown>;
  if ('user' in obj || 'repos' in obj) {
    return {
      user: (obj.user as GithubUser) ?? null,
      repos: Array.isArray(obj.repos) ? (obj.repos as GithubRepo[]) : [],
    };
  }
  // A bare user object (no repos).
  return { user: obj as GithubUser, repos: [] };
}

/** Distinct languages across non-fork repos, in stable first-seen order. */
function aggregateLanguages(repos: GithubRepo[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const remember = (lang: string) => {
    const key = lang.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(lang);
    }
  };
  for (const repo of repos) {
    if (repo.fork) continue;
    if (repo.languages && typeof repo.languages === 'object') {
      for (const lang of Object.keys(repo.languages)) if (!isBlank(lang)) remember(lang);
    } else if (repo.language && !isBlank(repo.language)) {
      remember(repo.language);
    }
  }
  return ordered;
}
