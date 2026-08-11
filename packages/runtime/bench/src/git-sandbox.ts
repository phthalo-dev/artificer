import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Strips a spawned process's path to the operator's real GitHub session.
 *
 * Every bench fixture is graded from a local patch/predictions.jsonl, never a
 * live push — a coding agent's shell access must never reach the operator's
 * real `gh`/git credentials, no matter how confused it gets about where its
 * scaffold "repo" should live. A prior incident: a greenfield fixture clone
 * has no real remote, but the operator's `gh` CLI was already authenticated
 * (macOS keychain-backed, no token env var required) on the host, and an
 * agent discovered it and pushed/opened a real PR on the operator's account.
 *
 * GH_CONFIG_DIR points at a fresh empty directory so `gh` sees no logged-in
 * host, the git credential helper is cleared via env-injected git config
 * (GIT_CONFIG_COUNT/KEY/VALUE — the only override that reliably takes effect;
 * GIT_CONFIG_SYSTEM is ignored by Apple's git build), and any inherited
 * token/SSH-agent env vars are stripped.
 */
export async function sandboxGithubEnv(
  baseEnv: NodeJS.ProcessEnv,
  execDir: string,
): Promise<NodeJS.ProcessEnv> {
  const ghConfigDir = path.join(execDir, '.gh-config-empty');
  await fs.mkdir(ghConfigDir, { recursive: true });

  const {
    GH_TOKEN: _ghToken,
    GITHUB_TOKEN: _githubToken,
    GH_ENTERPRISE_TOKEN: _ghEnterpriseToken,
    SSH_AUTH_SOCK: _sshAuthSock,
    ...rest
  } = baseEnv;

  return {
    ...rest,
    GH_CONFIG_DIR: ghConfigDir,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
  };
}
