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

test('parseEvalTaskManifest accepts repo-patch with repo url and baseCommit', () => {
  const m = parseEvalTaskManifest({
    id: 'fix-format-cost-display',
    title: 'Fix cost formatting',
    kind: 'repo-patch',
    tags: ['ui', 'regression'],
    timeoutMs: 900_000,
    maxRuns: 40,
    repo: {
      url: 'fixture',
      baseCommit: 'local',
    },
    grade: { type: 'shell', command: 'node --test tests/*.test.js' },
  });
  assert.equal(m.kind, 'repo-patch');
  assert.deepEqual(m.tags, ['ui', 'regression']);
  assert.equal(m.timeoutMs, 900_000);
  assert.equal(m.maxRuns, 40);
  assert.deepEqual(m.repo, { url: 'fixture', baseCommit: 'local' });
});

test('parseEvalTaskManifest rejects repo-patch without repo', () => {
  assert.throws(
    () =>
      parseEvalTaskManifest({
        id: 'x',
        title: 'x',
        kind: 'repo-patch',
        grade: { type: 'shell', command: 'true' },
      }),
    /repo-patch tasks require repo/,
  );
});

test('parseEvalTaskManifest accepts file-exists grade', () => {
  const m = parseEvalTaskManifest({
    id: 'write-plan',
    title: 'Write a plan',
    kind: 'workstream',
    grade: { type: 'file-exists', path: 'plan.md' },
  });
  assert.deepEqual(m.grade, { type: 'file-exists', path: 'plan.md' });
});

test('parseEvalSuite requires taskIds', () => {
  const s = parseEvalSuite({ name: 'Smoke', taskIds: ['a'] });
  assert.deepEqual(s.taskIds, ['a']);
});
