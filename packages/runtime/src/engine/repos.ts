import type { RepoConfig } from '../api/types.js';

const REPO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const GIT_AT_PATTERN = /^git@([^:]+):(.+)$/;

function normalizePathSegments(pathPart: string): string | undefined {
  const trimmed = pathPart.replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length !== 2) return undefined;
  return segments.map((s) => s.toLowerCase()).join('/');
}

export function repoUrlKey(url: string): string | undefined {
  if (url === '') return undefined;

  let normalized = url.trim();
  if (normalized === '') return undefined;

  normalized = normalized.replace(/\/+$/, '');
  if (normalized.endsWith('.git')) {
    normalized = normalized.slice(0, -4);
  }

  const gitAtMatch = normalized.match(GIT_AT_PATTERN);
  if (gitAtMatch) {
    const host = gitAtMatch[1].toLowerCase();
    const pathPart = gitAtMatch[2];
    const segments = normalizePathSegments(pathPart);
    if (!segments) return undefined;
    return `${host}/${segments}`;
  }

  if (!normalized.includes('://')) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return undefined;
  }

  if (parsed.protocol === 'https:') {
    const host = parsed.hostname.toLowerCase();
    const segments = normalizePathSegments(parsed.pathname);
    if (!segments) return undefined;
    return `${host}/${segments}`;
  }

  if (parsed.protocol === 'ssh:') {
    if (parsed.username !== 'git') return undefined;
    const host = parsed.hostname.toLowerCase();
    const segments = normalizePathSegments(parsed.pathname);
    if (!segments) return undefined;
    return `${host}/${segments}`;
  }

  return undefined;
}

export function loadRepos(
  repos: unknown,
): { ok: true; repos: RepoConfig[] } | { ok: false; error: string } {
  if (repos === undefined) return { ok: true, repos: [] };
  if (!Array.isArray(repos)) {
    return { ok: false, error: 'repos must be an array' };
  }

  const loaded: RepoConfig[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Map<string, string>();

  for (const entry of repos) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: 'each repo entry must be an object' };
    }

    const record = entry as Record<string, unknown>;
    const id = record.id;

    if (typeof id !== 'string' || !REPO_ID_PATTERN.test(id)) {
      return { ok: false, error: 'repo id must match ^[a-z0-9][a-z0-9-]*$' };
    }

    const url = record.url;
    if (typeof url !== 'string' || url.trim() === '') {
      return { ok: false, error: `repo "${id}" must have a non-empty url` };
    }

    const baseBranch = record.baseBranch;
    if (
      typeof baseBranch !== 'string' ||
      baseBranch === '' ||
      !/^\S+$/.test(baseBranch)
    ) {
      return { ok: false, error: `repo "${id}" must have a non-empty baseBranch` };
    }

    const key = repoUrlKey(url);
    if (!key) {
      return { ok: false, error: `repo "${id}" has an invalid url` };
    }

    if (seenIds.has(id)) {
      return { ok: false, error: `duplicate repo id "${id}"` };
    }

    if (seenKeys.has(key)) {
      return { ok: false, error: `duplicate repo URL for "${id}"` };
    }

    seenIds.add(id);
    seenKeys.set(key, id);
    loaded.push({ id, url, baseBranch });
  }

  return { ok: true, repos: loaded };
}

export function matchRepo(
  repos: RepoConfig[],
  repoUrl: string,
): RepoConfig | undefined {
  const key = repoUrlKey(repoUrl);
  if (!key) return undefined;
  return repos.find((repo) => repoUrlKey(repo.url) === key);
}
