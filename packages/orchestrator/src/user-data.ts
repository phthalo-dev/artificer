import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { InstanceCredentials } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getSetupScript(): string {
  return readFileSync(join(__dirname, '..', 'scripts', 'setup-agent.sh'), 'utf-8');
}

/**
 * Escape a value for use inside a single-quoted bash string.
 * Single-quoted strings prevent all shell interpretation, so the only
 * character that needs escaping is the single quote itself.
 */
function sq(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export function generateUserData(credentials: InstanceCredentials): string {
  const {
    opencodePassword,
    anthropicApiKey,
    githubToken,
    githubSshKey,
    githubEmail,
    githubUsername,
    workDirectory = '/home/ubuntu/workspace',
  } = credentials;

  // Prepend exports so the setup script can use $VAR / ${VAR} / ${VAR:-default}
  // normally without any text-substitution hacks.  Single-quoting the values
  // means no shell interpretation happens — safe for keys, tokens, etc.
  const envBlock = [
    '#!/bin/bash',
    `export GITHUB_TOKEN='${sq(githubToken || '')}'`,
    `export GITHUB_SSH_KEY='${sq(githubSshKey || '')}'`,
    `export GITHUB_EMAIL='${sq(githubEmail || '')}'`,
    `export GITHUB_USERNAME='${sq(githubUsername || '')}'`,
    `export ANTHROPIC_API_KEY='${sq(anthropicApiKey || '')}'`,
    `export OPENCODE_SERVER_PASSWORD='${sq(opencodePassword || '')}'`,
    `export WORKDIR='${sq(workDirectory)}'`,
    '',
  ].join('\n');

  // Strip the shebang from the setup script — we provide our own above.
  let script = getSetupScript();
  if (script.startsWith('#!/bin/bash')) {
    script = script.slice(script.indexOf('\n') + 1);
  }

  return envBlock + script;
}
