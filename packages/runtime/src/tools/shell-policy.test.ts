import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkGitCloneInWorkspace, checkReviewerWrite } from './shell-policy.js';

const workspace = path.join(os.tmpdir(), 'artificer-ws-test');

test('checkGitCloneInWorkspace allows workspace-relative clone', () => {
  const result = checkGitCloneInWorkspace(
    'git clone https://github.com/org/repo.git repo',
    workspace,
    workspace,
  );
  assert.equal(result.allowed, true);
});

test('checkGitCloneInWorkspace allows clone into dot', () => {
  const result = checkGitCloneInWorkspace(
    'git clone https://github.com/org/repo.git .',
    workspace,
    workspace,
  );
  assert.equal(result.allowed, true);
});

test('checkGitCloneInWorkspace blocks clone outside workspace', () => {
  const result = checkGitCloneInWorkspace(
    'git clone https://github.com/org/repo.git /tmp/outside-repo',
    workspace,
    workspace,
  );
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? '', /workspace subdirectory/i);
});

test('checkGitCloneInWorkspace blocks chained clone to /tmp', () => {
  const result = checkGitCloneInWorkspace(
    'cd /tmp && git clone https://github.com/org/repo.git my-repo',
    workspace,
    workspace,
  );
  assert.equal(result.allowed, false);
});

// --- reviewer write-guard ---

const blockedForReviewer: [string, string][] = [
  ["sed -i 's/a/b/' requests/adapters.py", 'sed -i'],
  ['patch -p1 < fix.diff', 'patch'],
  ['git checkout HEAD~1 requests/adapters.py', 'git checkout'],
  ['git reset --hard HEAD', 'git reset'],
  ['git apply fix.diff', 'git apply'],
  ['git restore requests/adapters.py', 'git restore'],
  ['rm reproduce_issue.py', 'rm'],
  ['mv a.py b.py', 'mv'],
  ['echo "x" > requests/adapters.py', 'redirection'],
  ['cat fix.diff | tee requests/adapters.py', 'tee'],
  ['cd requests && sed -i "1d" adapters.py', 'chained sed -i'],
  ["perl -i -pe 's/a/b/' file.py", 'perl -i'],
];

for (const [command, label] of blockedForReviewer) {
  test(`checkReviewerWrite blocks ${label} for reviewer`, () => {
    const result = checkReviewerWrite(command, 'reviewer');
    assert.equal(result.allowed, false, `expected blocked: ${command}`);
    assert.match(result.reason ?? '', /read-only|record an issue/i);
  });
}

const allowedForReviewer: [string, string][] = [
  ['git diff HEAD requests/adapters.py', 'git diff'],
  ['git show 0be38a0c:requests/adapters.py', 'git show'],
  ['python3 -m pytest -q', 'pytest'],
  ['grep -n "def send" requests/adapters.py 2>/dev/null', 'grep with 2>/dev/null'],
  ['cat requests/adapters.py > /dev/null', 'redirect to /dev/null'],
  ['ls -la requests', 'ls'],
  ['git status', 'git status'],
];

for (const [command, label] of allowedForReviewer) {
  test(`checkReviewerWrite allows ${label} for reviewer`, () => {
    const result = checkReviewerWrite(command, 'reviewer');
    assert.equal(result.allowed, true, `expected allowed: ${command}`);
  });
}

test('checkReviewerWrite allows mutations for non-reviewer roles', () => {
  assert.equal(checkReviewerWrite("sed -i 's/a/b/' f.py", 'worker').allowed, true);
  assert.equal(checkReviewerWrite('rm scratch.py', 'planner').allowed, true);
});
