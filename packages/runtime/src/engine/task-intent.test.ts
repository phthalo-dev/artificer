import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isRepoTaskMessage,
  looksLikeRepoSource,
  parseWorkstreamHeader,
} from './task-intent.js';

test('parseWorkstreamHeader extracts repo fields', () => {
  const content = [
    '--- WORKSTREAM ---',
    'repoUrl: https://github.com/true-myth/true-myth.git',
    'baseCommit: d8fbebc75de4991a32354518beff1abf628d0b07',
    'title: true-myth iterable collection combinators',
    '---',
    '',
    'Fix the bug.',
  ].join('\n');

  const header = parseWorkstreamHeader(content);
  assert.ok(header);
  assert.equal(header.repoUrl, 'https://github.com/true-myth/true-myth.git');
  assert.equal(header.baseCommit, 'd8fbebc75de4991a32354518beff1abf628d0b07');
  assert.equal(header.title, 'true-myth iterable collection combinators');
});

test('isRepoTaskMessage detects bench-style tasks', () => {
  assert.equal(
    isRepoTaskMessage(
      'Setup (do this first): clone https://github.com/org/repo.git and check out the exact base commit abc123',
    ),
    true,
  );
  assert.equal(isRepoTaskMessage('What do you think about React?'), false);
});

test('looksLikeRepoSource matches repo URLs not docs', () => {
  assert.equal(looksLikeRepoSource('https://github.com/org/repo.git'), true);
  assert.equal(
    looksLikeRepoSource('https://github.com/org/repo/tree/main/docs'),
    true,
  );
  assert.equal(looksLikeRepoSource('https://docs.example.com/guide'), false);
});
