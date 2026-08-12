import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvalTaskManifest, parseEvalSuite } from './types.js';

test('parseEvalTaskManifest accepts message task', () => {
  const m = parseEvalTaskManifest({
    id: 'status-preset-query',
    title: 'Preset query',
    kind: 'message',
    grade: { type: 'message-contains', pattern: 'async-economy' },
  });
  assert.equal(m.kind, 'message');
});

test('parseEvalTaskManifest rejects repo-patch in phase 1', () => {
  assert.throws(() =>
    parseEvalTaskManifest({
      id: 'x',
      title: 'x',
      kind: 'repo-patch',
      grade: { type: 'shell', command: 'true' },
    }),
  );
});

test('parseEvalSuite requires taskIds', () => {
  const s = parseEvalSuite({ name: 'Smoke', taskIds: ['a'] });
  assert.deepEqual(s.taskIds, ['a']);
});
