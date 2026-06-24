import path from 'node:path';
import type { GitHubConfig } from '../config.js';

/**
 * Builds the environment for git/gh/shell commands so they act as the agent's
 * own GitHub account. When no token is configured, returns `process.env`
 * unchanged so tools fall back to whatever ambient credentials exist.
 *
 * Auth is injected entirely through the environment (never the user's global
 * git config), so it is non-intrusive locally and works identically in a cloud
 * container that only sets `GITHUB_TOKEN`:
 *
 * - `gh` reads `GH_TOKEN`/`GITHUB_TOKEN` automatically.
 * - `git` HTTPS uses a credential helper supplied via `GIT_CONFIG_*` env keys,
 *   which keeps the token out of remote URLs (and thus out of tool output).
 * - Commit identity comes from `GIT_AUTHOR_*`/`GIT_COMMITTER_*`.
 *
 * When `workspaceDir` is provided, `GIT_CEILING_DIRECTORIES` is set to its
 * parent directory so git commands inside the workspace cannot walk up into
 * the agent identity repo.
 */
export function buildGitEnv(
  github: GitHubConfig | undefined,
  base: NodeJS.ProcessEnv = process.env,
  workspaceDir?: string,
): NodeJS.ProcessEnv {
  if (!github && !workspaceDir) return base;

  if (!github) {
    return workspaceDir
      ? { ...base, GIT_CEILING_DIRECTORIES: path.dirname(workspaceDir) }
      : base;
  }

  const env: NodeJS.ProcessEnv = {
    ...base,
    GH_TOKEN: github.token,
    GITHUB_TOKEN: github.token,
  };

  // Configure a github.com credential helper via env-based git config. The
  // empty helper first resets any inherited (user's) helper so ours wins; the
  // helper then echoes a fixed username and the token from $GH_TOKEN.
  const helper =
    '!f() { test "$1" = get && echo "username=x-access-token" && echo "password=$GH_TOKEN"; }; f';
  const entries: Array<[string, string]> = [
    ['credential.https://github.com.helper', ''],
    ['credential.https://github.com.helper', helper],
  ];

  if (github.userName) {
    env.GIT_AUTHOR_NAME = github.userName;
    env.GIT_COMMITTER_NAME = github.userName;
  }
  if (github.userEmail) {
    env.GIT_AUTHOR_EMAIL = github.userEmail;
    env.GIT_COMMITTER_EMAIL = github.userEmail;
  }

  env.GIT_CONFIG_COUNT = String(entries.length);
  entries.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });

  if (workspaceDir) {
    env.GIT_CEILING_DIRECTORIES = path.dirname(workspaceDir);
  }

  return env;
}
