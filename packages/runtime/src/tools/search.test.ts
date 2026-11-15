import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveScoped } from './files.js';
import { buildGlobRipgrepArgs, buildRipgrepArgs } from './search.js';

test('buildRipgrepArgs includes pattern and workspace root', () => {
  const args = buildRipgrepArgs(
    { pattern: 'foo', path: 'src', glob: '*.ts', head_limit: 10 },
    '/ws/src',
  );
  assert.ok(args.includes('foo'));
  assert.ok(args.includes('/ws/src'));
  assert.ok(args.includes('-g'));
  assert.ok(args.includes('*.ts'));
});

test('buildGlobRipgrepArgs includes pattern and search path', () => {
  const args = buildGlobRipgrepArgs('**/*.ts', '/ws');
  assert.ok(args.includes('--files'));
  assert.ok(args.includes('**/*.ts'));
  assert.ok(args.includes('/ws'));
});

test('resolveScoped rejects path escape for grep search paths', () => {
  assert.throws(
    () => resolveScoped('/workspace', '../../etc'),
    /escapes the workspace/,
  );
});
