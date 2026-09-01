import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { IdentityLayout } from '../storage/identity-layout.js';
import { Layout } from '../storage/layout.js';
import {
  type PolicyRule,
  fetchApprovalKey,
  isDangerousShellCommand,
  loadEffectivePolicy,
  matchRule,
  saveExecPolicy,
  shellApprovalKey,
} from './tool-policy.js';

function rule(
  id: string,
  effect: PolicyRule['effect'],
  pattern = 'npm *',
): PolicyRule {
  return {
    id,
    tool: 'run_shell',
    pattern,
    effect,
    scope: 'agent',
    createdAt: '2026-08-25T00:00:00.000Z',
  };
}

test('shellApprovalKey keeps the command prefix selected by its arity', () => {
  const cases = [
    ['npm install lodash', 'npm install'],
    ['git push origin feature', 'git push'],
    ['docker compose up --build', 'docker compose up'],
    ['docker-compose up api --detach', 'docker-compose up api'],
    ['python script.py --verbose', 'python script.py'],
  ] as const;

  for (const [command, expected] of cases) {
    assert.equal(shellApprovalKey(command), expected, command);
  }
});

test('shellApprovalKey redacts secret environment assignments', () => {
  const key = shellApprovalKey('TOKEN=supersecret npm install lodash');

  assert.equal(key, 'npm install');
  assert.doesNotMatch(key, /supersecret/);
});

test('shellApprovalKey redacts quoted token-like secrets', () => {
  const key = shellApprovalKey('echo "ghp_abc123"');

  assert.doesNotMatch(key, /ghp_/);
});

test('fetchApprovalKey uses an uppercase method and omits query and hash', () => {
  assert.equal(
    fetchApprovalKey(
      'post',
      'https://example.com/api/packages?token=secret#response',
    ),
    'POST https://example.com/api/packages',
  );
});

test('fetchApprovalKey returns a fallback for invalid or empty URLs', () => {
  assert.equal(fetchApprovalKey('GET', ''), 'GET <invalid-url>');
  assert.equal(fetchApprovalKey('post', 'not a url'), 'POST <invalid-url>');
});

test('shellApprovalKey keeps rm flags and path operands distinct', () => {
  assert.equal(
    shellApprovalKey('rm -rf ./node_modules'),
    'rm -rf ./node_modules',
  );
  assert.equal(shellApprovalKey('rm -rf /'), 'rm -rf /');
  assert.notEqual(
    shellApprovalKey('rm -rf ./node_modules'),
    shellApprovalKey('rm -rf /'),
  );
  assert.equal(shellApprovalKey('rmdir empty-dir'), 'rmdir empty-dir');
});

test('shellApprovalKey keys chained commands from each segment', () => {
  assert.equal(
    shellApprovalKey('git status && git push origin main'),
    'git status && git push',
  );
  assert.notEqual(
    shellApprovalKey('git status && git push origin main'),
    'git status',
  );
  assert.equal(
    shellApprovalKey('git status; git push origin main'),
    'git status && git push',
  );
});

test('shellApprovalKey and danger detection use the executable basename', () => {
  assert.equal(shellApprovalKey('/usr/bin/git push origin main'), 'git push');
  assert.equal(shellApprovalKey('/bin/rm -rf /'), 'rm -rf /');
});

test('isDangerousShellCommand identifies dangerous and read-only commands', () => {
  const dangerous = [
    'rm -rf /',
    'rm -r -f build',
    '/bin/rm -rf /',
    "'rm' -rf /",
    'git push origin main',
    '/usr/bin/git push origin main',
    'git push --force origin main',
    'git -C repo push origin main',
    'git reset --hard HEAD',
    'git rebase main',
    'git clean -fd',
    'git status && git push origin main',
    'git status\ngit push origin main',
    'curl -X POST https://example.com',
    'wget --post-data=x https://example.com',
    'ssh deploy@example.com',
    'kubectl apply -f deployment.yaml',
    'kubectl --context prod apply -f deployment.yaml',
    'kubectl --username admin apply',
    'terraform apply',
    'terraform -chdir=infra apply',
    'helm upgrade api chart',
    'helm --namespace prod upgrade api chart',
    'helm -n prod upgrade api chart',
  ];
  const safe = [
    'git status',
    'git diff',
    'git log',
    'git show HEAD',
    'git add src/index.ts',
    'git commit -m "safe"',
    'git checkout abc123',
    'git checkout -b feature',
    'curl -f https://example.com',
    'wget --method=GET https://example.com',
    'terraform plan -out=apply',
    'kubectl get configmap apply',
  ];

  for (const command of dangerous) {
    assert.equal(isDangerousShellCommand(command), true, command);
  }
  for (const command of safe) {
    assert.equal(isDangerousShellCommand(command), false, command);
  }
});

test('loadEffectivePolicy returns an empty policy for missing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-policy-'));
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    assert.deepEqual(
      loadEffectivePolicy({
        execPath: path.join(root, 'missing-exec.json'),
        identityPath: path.join(root, 'missing-identity.json'),
      }),
      { version: 1, rules: [] },
    );
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = originalWarn;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadEffectivePolicy warns and uses empty rules for corrupt JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-policy-'));
  const execPath = path.join(root, 'tool-policy.json');
  fs.writeFileSync(execPath, '{not-json', 'utf8');
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    assert.deepEqual(loadEffectivePolicy({ execPath }), {
      version: 1,
      rules: [],
    });
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadEffectivePolicy gives exec rules precedence over identity rules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-policy-'));
  const identityPath = path.join(root, 'identity-policy.json');
  const execPath = path.join(root, 'exec-policy.json');
  fs.writeFileSync(
    identityPath,
    JSON.stringify({ version: 1, rules: [rule('identity', 'allow')] }),
  );
  fs.writeFileSync(
    execPath,
    JSON.stringify({ version: 1, rules: [rule('exec', 'deny')] }),
  );

  try {
    const policy = loadEffectivePolicy({ execPath, identityPath });

    assert.deepEqual(policy.rules, [rule('exec', 'deny')]);
    assert.equal(matchRule(policy, 'run_shell', 'npm install')?.id, 'exec');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('matchRule supports glob patterns', () => {
  const matching = rule('glob', 'allow');

  assert.equal(
    matchRule({ version: 1, rules: [matching] }, 'run_shell', 'npm install'),
    matching,
  );
});

test('matchRule prefers deny and otherwise the last matching rule', () => {
  const rules = [
    rule('first-allow', 'allow', 'npm *'),
    rule('deny', 'deny', '* install'),
    rule('last-allow', 'allow', 'npm install'),
  ];

  assert.equal(
    matchRule({ version: 1, rules }, 'run_shell', 'npm install')?.id,
    'deny',
  );
  assert.equal(
    matchRule(
      {
        version: 1,
        rules: rules.filter((candidate) => candidate.effect === 'allow'),
      },
      'run_shell',
      'npm install',
    )?.id,
    'last-allow',
  );
});

test('saveExecPolicy writes the supplied policy file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-policy-'));
  const execPath = path.join(root, 'nested', 'tool-policy.json');
  const file = { version: 1 as const, rules: [rule('saved', 'allow')] };

  try {
    saveExecPolicy(execPath, file);
    assert.deepEqual(JSON.parse(fs.readFileSync(execPath, 'utf8')), file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('policy layout helpers resolve their policy file locations', () => {
  assert.equal(
    new Layout('/exec').toolPolicyFile(),
    path.join('/exec', 'tool-policy.json'),
  );
  assert.equal(
    new IdentityLayout('/identity').agentToolPolicyFile(),
    path.join('/identity', 'agent', 'tool-policy.json'),
  );
});
