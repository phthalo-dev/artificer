import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { init, makeConfigJson } from './init.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('makeConfigJson returns valid JSON with name and default preset', () => {
  const raw = makeConfigJson('demo-agent');
  const config = JSON.parse(raw);
  assert.equal(config.name, 'demo-agent');
  assert.equal(
    config.$schema,
    './node_modules/@artificer-ai/runtime/artificer.config.schema.json',
  );
  assert.equal(config.preset, 'go-economy');
  assert.equal(config.quota.routes[0].presetId, 'go-economy');
  assert.equal(config.quota.routes[1].presetId, 'async-economy');
});

test('init scaffolds expected files and directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-init-'));
  tempDirs.push(dir);
  init('demo-agent', dir);

  assert.ok(fs.existsSync(path.join(dir, 'artificer.config.json')));
  assert.ok(fs.existsSync(path.join(dir, 'agent', 'instructions.md')));
  assert.ok(fs.existsSync(path.join(dir, 'package.json')));
  assert.ok(fs.existsSync(path.join(dir, '.env.example')));
  assert.ok(fs.existsSync(path.join(dir, 'agent', 'tools')));
  assert.ok(fs.existsSync(path.join(dir, 'agent', 'channels')));
  assert.ok(fs.existsSync(path.join(dir, 'agent', 'skills')));
  assert.ok(fs.existsSync(path.join(dir, 'identity', 'memories')));
  assert.ok(
    fs.existsSync(path.join(dir, 'agent', 'evals', 'suites', 'smoke.json')),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        dir,
        'agent',
        'evals',
        'tasks',
        'status-preset-query',
        'prompt.md',
      ),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        dir,
        'agent',
        'evals',
        'tasks',
        'implement-hello-tool',
        'fixture',
        'src',
        'hello.js',
      ),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        dir,
        'agent',
        'evals',
        'tasks',
        'fix-format-cost-display',
        'fixture',
        'introduce-bug.patch',
      ),
    ),
  );
  const smoke = JSON.parse(
    fs.readFileSync(
      path.join(dir, 'agent', 'evals', 'suites', 'smoke.json'),
      'utf8',
    ),
  ) as { taskIds: string[] };
  assert.deepEqual(smoke.taskIds, [
    'status-preset-query',
    'fix-format-cost-display',
    'implement-hello-tool',
  ]);

  const written = JSON.parse(
    fs.readFileSync(path.join(dir, 'artificer.config.json'), 'utf8'),
  );
  assert.equal(written.name, 'demo-agent');
});

test('init throws when target directory is not empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-init-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'existing.txt'), 'nope');

  assert.throws(
    () => init('demo-agent', dir),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes('already exists and is not empty'),
  );
});
