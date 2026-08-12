import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { gradeGreenfieldPatch } from './grade-greenfield.js';
import {
  applyIntroduceBugPatch,
  materializeRepoPatch,
} from './repo-patch-fixture.js';

const execFileAsync = promisify(execFile);
const fixtureRoot = fileURLToPath(
  new URL('./fixtures/fix-format-cost-display/', import.meta.url),
);

test('materializeRepoPatch applies introduce-bug.patch for fixture url', async () => {
  const fixture = await materializeRepoPatch({
    repo: { url: 'fixture', baseCommit: 'local' },
    fixtureDir: path.join(fixtureRoot, 'fixture'),
  });

  try {
    const source = await fs.readFile(
      path.join(fixture.repoDir, 'src', 'format.js'),
      'utf8',
    );
    assert.match(source, /Bug: always rounds/);
    assert.doesNotMatch(source, /usd < 0\.01/);

    const log = await git(fixture.repoDir, ['log', '--oneline']);
    assert.match(log, /introduce-bug/);
    assert.equal(
      (await git(fixture.repoDir, ['rev-parse', 'HEAD'])).trim(),
      fixture.baseCommit,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('grading fails on buggy base and passes after fix patch', async () => {
  const fixture = await materializeRepoPatch({
    repo: { url: 'fixture', baseCommit: 'local' },
    fixtureDir: path.join(fixtureRoot, 'fixture'),
  });
  const hiddenDir = path.join(fixtureRoot, 'hidden');

  try {
    const failing = await gradeGreenfieldPatch({
      repoDir: fixture.repoDir,
      patch: '',
      hiddenDir,
      command: 'node --test tests/*.test.js',
    });
    assert.equal(failing, false);

    const fixPatch = [
      'diff --git a/src/format.js b/src/format.js',
      '--- a/src/format.js',
      '+++ b/src/format.js',
      '@@ -1,5 +1,5 @@',
      ' export function formatCost(usd) {',
      "   if (!usd) return '$0.00';",
      '-  // Bug: always rounds to 2 decimals, hiding sub-cent costs as $0.00',
      '+  if (usd < 0.01) return `$${usd.toFixed(4)}`;',
      '   return `$${usd.toFixed(2)}`;',
      ' }',
      '',
    ].join('\n');

    const passing = await gradeGreenfieldPatch({
      repoDir: fixture.repoDir,
      patch: fixPatch,
      hiddenDir,
      command: 'node --test tests/*.test.js',
    });
    assert.equal(passing, true);
  } finally {
    await fixture.cleanup();
  }
});

test('applyIntroduceBugPatch is a no-op when patch file is absent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'no-bug-patch-'));
  const fixtureDir = path.join(root, 'fixture');
  const repoDir = path.join(root, 'repo');
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, 'a.js'), 'export {};\n');
  await git(repoDir, ['init', '-q']);
  await git(repoDir, ['config', 'user.email', 'eval@artificer.local']);
  await git(repoDir, ['config', 'user.name', 'artificer-eval']);
  await git(repoDir, ['add', '-A']);
  await git(repoDir, ['commit', '-q', '-m', 'init']);

  try {
    assert.equal(await applyIntroduceBugPatch(fixtureDir, repoDir), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}
