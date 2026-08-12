import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseEvalSuite, parseEvalTaskManifest } from '../types.js';

const examplesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../evals/examples/runtime-dev',
);

test('Pack B suite and task manifests parse', async () => {
  const suiteRaw = JSON.parse(
    await fs.readFile(path.join(examplesRoot, 'suites', 'smoke.json'), 'utf8'),
  );
  const suite = parseEvalSuite(suiteRaw);
  assert.equal(suite.name, 'Runtime-dev smoke');
  assert.ok(suite.taskIds.length >= 5);

  for (const taskId of suite.taskIds) {
    const manifestPath = path.join(
      examplesRoot,
      'tasks',
      taskId,
      'eval.json',
    );
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const manifest = parseEvalTaskManifest(raw);
    assert.equal(manifest.id, taskId);

    const prompt = await fs.readFile(
      path.join(examplesRoot, 'tasks', taskId, 'prompt.md'),
      'utf8',
    );
    assert.ok(prompt.trim().length > 0);

    if (manifest.kind === 'repo-patch') {
      assert.equal(manifest.repo?.url, 'fixture');
      await fs.access(
        path.join(examplesRoot, 'tasks', taskId, 'fixture', 'package.json'),
      );
      await fs.access(
        path.join(
          examplesRoot,
          'tasks',
          taskId,
          'fixture',
          'introduce-bug.patch',
        ),
      );
    }
  }
});
