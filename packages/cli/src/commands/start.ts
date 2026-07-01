import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);

async function setupIdentityRepo(): Promise<string | undefined> {
  const identityRepo = process.env.IDENTITY_REPO;
  if (!identityRepo) return undefined;

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    console.error('[artificer] GITHUB_TOKEN must be set when IDENTITY_REPO is used');
    process.exit(1);
  }

  const identityDir = path.resolve(process.env.IDENTITY_DIR ?? '/data/identity');

  // Derive commit identity from the token's GitHub account
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'artificer' },
  });
  if (!res.ok) {
    console.error(`[artificer] GitHub API error fetching user: ${res.status}`);
    process.exit(1);
  }
  const user = (await res.json()) as { name?: string; login: string; id: number };
  const name = user.name || user.login;
  const email = `${user.id}+${user.login}@users.noreply.github.com`;

  await exec('git', ['config', '--global', 'user.name', name]);
  await exec('git', ['config', '--global', 'user.email', email]);
  await exec('git', [
    'config', '--global',
    'credential.https://github.com.helper',
    `!f() { echo username=x-access-token; echo password=${token}; }; f`,
  ]);

  // Propagate into env so buildGitEnv picks up identity for commit authorship
  process.env.GITHUB_USER_NAME = name;
  process.env.GITHUB_USER_EMAIL = email;

  if (fs.existsSync(path.join(identityDir, '.git'))) {
    console.log(`[artificer] Pulling identity from ${identityRepo}...`);
    await exec('git', ['-C', identityDir, 'pull', '--rebase', 'origin']);
  } else {
    console.log(`[artificer] Cloning identity from ${identityRepo}...`);
    await exec('git', ['clone', `https://github.com/${identityRepo}`, identityDir]);
  }

  return identityDir;
}

export async function start(rootDir?: string): Promise<void> {
  if (!process.env.ARTIFICER_API_KEY) {
    console.warn(
      '[artificer] Warning: ARTIFICER_API_KEY is not set. API authentication is disabled.',
    );
    console.warn(
      '[artificer] Set ARTIFICER_API_KEY in your .env for production use.',
    );
  }

  const identityDir = await setupIdentityRepo();
  const resolved = path.resolve(identityDir ?? rootDir ?? process.cwd());

  const { createRuntime } = await import('@artificer-ai/runtime');

  const runtime = await createRuntime({ rootDir: resolved });

  console.log(
    `[artificer] Starting ${runtime.config.agentName} in production mode`,
  );
  await runtime.start();
}
