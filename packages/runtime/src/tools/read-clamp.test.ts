import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DEFAULT_READ_LINES, clampFileContent } from './read-clamp.js';

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

test('returns small files unchanged', () => {
  const c = lines(50);
  assert.equal(clampFileContent(c), c);
});

test('caps a large file to the default line budget with a note', () => {
  const out = clampFileContent(lines(2000));
  assert.match(out, /line 1\b/);
  assert.match(out, new RegExp(`line ${DEFAULT_READ_LINES}\\b`));
  assert.doesNotMatch(out, new RegExp(`line ${DEFAULT_READ_LINES + 1}\\b`));
  assert.match(out, new RegExp(`lines 1-${DEFAULT_READ_LINES} of 2000`));
  assert.match(out, /offset\/limit|grep/i);
});

test('honors offset and limit', () => {
  const out = clampFileContent(lines(2000), { offset: 200, limit: 10 });
  assert.match(out, /line 200\b/);
  assert.match(out, /line 209\b/);
  assert.doesNotMatch(out, /line 210\b/);
  assert.match(out, /lines 200-209 of 2000/);
});

test('clamps offset past EOF without throwing', () => {
  const out = clampFileContent(lines(10), { offset: 50, limit: 10 });
  assert.match(out, /of 10/);
});
