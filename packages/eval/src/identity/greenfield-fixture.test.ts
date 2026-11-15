import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  materializeGreenfieldFixture,
  overlayHiddenFixture,
} from './greenfield-fixture.js';

test('materializes fixture files as a clean git repository', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'greenfield-fixture-'));
  const fixtureDir = path.join(root, 'fixture');
  await fs.mkdir(path.join(fixtureDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(fixtureDir, 'src', 'index.js'), 'export {};\n');

  try {
    const fixture = await materializeGreenfieldFixture(fixtureDir);
    const [source, head, status] = await Promise.all([
      fs.readFile(path.join(fixture.repoDir, 'src', 'index.js'), 'utf8'),
      git(fixture.repoDir, ['rev-parse', 'HEAD']),
      git(fixture.repoDir, ['status', '--porcelain']),
    ]);

    assert.equal(source, 'export {};\n');
    assert.equal(head.trim(), fixture.baseCommit);
    assert.equal(status, '');
    await fixture.cleanup();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('hidden overlay replaces colliding trees without retaining agent files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'greenfield-overlay-'));
  const repoDir = path.join(root, 'repo');
  const hiddenDir = path.join(root, 'hidden');
  await fs.mkdir(path.join(repoDir, 'tests'), { recursive: true });
  await fs.mkdir(path.join(hiddenDir, 'tests'), { recursive: true });
  await fs.writeFile(path.join(repoDir, 'tests', 'agent.test.js'), 'unsafe\n');
  await fs.writeFile(path.join(hiddenDir, 'tests', 'hidden.test.js'), 'safe\n');

  try {
    await overlayHiddenFixture(hiddenDir, repoDir);
    assert.deepEqual(await fs.readdir(path.join(repoDir, 'tests')), [
      'hidden.test.js',
    ]);
    assert.equal(
      await fs.readFile(path.join(repoDir, 'tests', 'hidden.test.js'), 'utf8'),
      'safe\n',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: string[]): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', args, { cwd });
  return stdout;
}
