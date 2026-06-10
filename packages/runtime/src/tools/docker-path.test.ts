import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDockerExecFailure,
  rewriteDockerShellCommand,
} from './docker-path.js';

test('rewriteDockerShellCommand strips repo/ prefix for container paths', () => {
  assert.equal(
    rewriteDockerShellCommand('cd repo && tail -300 src/maybe.ts'),
    'tail -300 src/maybe.ts',
  );
  assert.equal(
    rewriteDockerShellCommand('head -50 repo/src/maybe.ts'),
    'head -50 src/maybe.ts',
  );
  assert.equal(
    rewriteDockerShellCommand('ls /app/repo/src/'),
    'ls /app/src/',
  );
});

test('formatDockerExecFailure omits docker exec argv from message', () => {
  const out = formatDockerExecFailure({
    message:
      'Command failed: docker exec -w /app -e PAGER=less -e FOO=bar container bash -lc "cd repo"',
    stdout: '',
    stderr: 'bash: cd: repo: No such file or directory',
  });
  assert.match(out, /No such file or directory/);
  assert.doesNotMatch(out, /docker exec -w/);
});
