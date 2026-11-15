import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEvalsDir } from './paths.js';
import { loadEvalSuite, listEvalSuites } from './load-suite.js';
import { loadEvalTask, listEvalTasks } from './load-task.js';

const FIXTURE_IDENTITY_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'agent-project',
);

test('resolveEvalsDir joins agent/evals under identity root', () => {
  assert.equal(
    resolveEvalsDir('/tmp/my-agent'),
    path.join('/tmp/my-agent', 'agent', 'evals'),
  );
});

test('listEvalSuites returns suite ids from fixtures', async () => {
  const suites = await listEvalSuites(FIXTURE_IDENTITY_DIR);
  assert.deepEqual(suites, ['smoke']);
});

test('loadEvalSuite parses smoke suite', async () => {
  const suite = await loadEvalSuite(FIXTURE_IDENTITY_DIR, 'smoke');
  assert.equal(suite.name, 'Smoke');
  assert.deepEqual(suite.taskIds, ['hello-message']);
});

test('listEvalTasks returns task ids from fixtures', async () => {
  const tasks = await listEvalTasks(FIXTURE_IDENTITY_DIR);
  assert.deepEqual(tasks, ['hello-message']);
});

test('loadEvalTask loads manifest, prompt, and taskDir', async () => {
  const task = await loadEvalTask(FIXTURE_IDENTITY_DIR, 'hello-message');
  assert.equal(task.manifest.id, 'hello-message');
  assert.equal(task.manifest.title, 'Hello');
  assert.equal(task.manifest.kind, 'message');
  assert.equal(task.prompt.trim(), 'What model preset am I using?');
  assert.equal(
    task.taskDir,
    path.join(resolveEvalsDir(FIXTURE_IDENTITY_DIR), 'tasks', 'hello-message'),
  );
  assert.equal(task.fixtureDir, undefined);
  assert.equal(task.hiddenDir, undefined);
});
