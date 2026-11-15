import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { materializeGreenfieldFixture } from './greenfield-fixture.js';
import { gradeGreenfieldPatch, nodeTestCount } from './grade-greenfield.js';

test('nodeTestCount reads spec and TAP summaries', () => {
  assert.equal(nodeTestCount('ℹ tests 3\nℹ pass 3\n'), 3);
  assert.equal(
    nodeTestCount(
      [
        'TAP version 13',
        '# Subtest: formatCost formats zero and small amounts',
        'ok 1 - formatCost formats zero and small amounts',
        '1..1',
        '# tests 1',
        '# pass 1',
        '# fail 0',
        '',
      ].join('\n'),
    ),
    1,
  );
  assert.equal(nodeTestCount('1..2\n'), 2);
  assert.equal(nodeTestCount('no reporter summary here\n'), 0);
});

test('nodeTestCount ignores ANSI colors from forced-color runs', () => {
  // `vp run` sets FORCE_COLOR=1 when CI is set, so node --test colors its summary.
  assert.equal(
    nodeTestCount('\u001b[34mℹ \u001b[39mtests \u001b[34m3\u001b[39m\n'),
    3,
  );
});

test('shell grader applies a patch and runs hidden ESM node tests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'greenfield-grade-'));
  const fixtureDir = path.join(root, 'fixture');
  const hiddenDir = path.join(root, 'hidden');
  await fs.mkdir(path.join(fixtureDir, 'src'), { recursive: true });
  await fs.mkdir(path.join(hiddenDir, 'tests'), { recursive: true });
  await fs.writeFile(
    path.join(fixtureDir, 'package.json'),
    '{"type":"module"}\n',
  );
  await fs.writeFile(
    path.join(fixtureDir, 'src', 'hello.js'),
    'export function hello() { throw new Error("TODO"); }\n',
  );
  await fs.writeFile(
    path.join(hiddenDir, 'tests', 'hello.test.js'),
    [
      "import assert from 'node:assert/strict';",
      "import { test } from 'node:test';",
      "import { hello } from '../src/hello.js';",
      "test('greets a name', () => assert.equal(hello('Ada'), 'Hello, Ada!'));",
      '',
    ].join('\n'),
  );

  try {
    const fixture = await materializeGreenfieldFixture(fixtureDir);
    const patch = [
      'diff --git a/src/hello.js b/src/hello.js',
      'index 6ee2ba2..fc07daf 100644',
      '--- a/src/hello.js',
      '+++ b/src/hello.js',
      '@@ -1 +1 @@',
      '-export function hello() { throw new Error("TODO"); }',
      '+export function hello(name) { return `Hello, ${name}!`; }',
      '',
    ].join('\n');

    const passed = await gradeGreenfieldPatch({
      repoDir: fixture.repoDir,
      patch,
      hiddenDir,
      command: 'node --test --test-reporter=tap tests/*.test.js',
    });

    assert.equal(passed, true);
    await fixture.cleanup();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('shell grader fails when the command runs zero tests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'greenfield-grade-'));
  const fixtureDir = path.join(root, 'fixture');
  const hiddenDir = path.join(root, 'hidden');
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.mkdir(hiddenDir, { recursive: true });
  await fs.writeFile(path.join(fixtureDir, 'index.js'), 'export {};\n');

  try {
    const fixture = await materializeGreenfieldFixture(fixtureDir);
    const passed = await gradeGreenfieldPatch({
      repoDir: fixture.repoDir,
      patch: '',
      hiddenDir,
      command: 'node --test',
    });

    assert.equal(passed, false);
    await fixture.cleanup();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
