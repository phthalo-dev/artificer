import assert from 'node:assert/strict';
import { test } from 'vitest';
import { extractPreferences } from './extract.js';

test('extracts always/never standing instructions', () => {
  const found = extractPreferences([
    'Always use pnpm, never npm.',
    'Never commit directly to main.',
  ]);
  assert.deepEqual(found, [
    'Always use pnpm, never npm.',
    'Never commit directly to main.',
  ]);
});

test('extracts stated preferences and directed asks', () => {
  const found = extractPreferences([
    'I prefer bun over npm for scripts.',
    'I want you to write tests before implementation.',
    'Make sure you run lint before committing.',
  ]);
  assert.equal(found.length, 3);
  assert.ok(found.some((s) => /bun over npm/.test(s)));
  assert.ok(found.some((s) => /tests before/.test(s)));
  assert.ok(found.some((s) => /run lint/.test(s)));
});

test('extracts matching sentences from a longer user message', () => {
  const found = extractPreferences([
    [
      'The auth module is messy.',
      'Always check existing tests before modifying it.',
      'Then open a PR.',
    ].join(' '),
  ]);
  assert.deepEqual(found, ['Always check existing tests before modifying it.']);
});

test('skips questions, bug reports, and first-person habits', () => {
  const found = extractPreferences([
    'Should I always use bun?',
    "I'm always chasing better tools.",
    'This always fails on CI.',
    "I don't know what happened.",
  ]);
  assert.deepEqual(found, []);
});

test('skips code fences, diffs, and harness noise', () => {
  const found = extractPreferences([
    '```ts\nalways use foo\n```',
    'diff --git a/x b/x\n+always use foo',
    '<command-name>/clear</command-name>',
    '<environment_context>cwd=/tmp</environment_context>',
  ]);
  assert.deepEqual(found, []);
});

test('deduplicates equivalent wording', () => {
  const found = extractPreferences([
    'Always use pnpm.',
    'always use pnpm.',
    '  Always   use   pnpm.  ',
  ]);
  assert.deepEqual(found, ['Always use pnpm.']);
});
