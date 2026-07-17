import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  rankMemories,
  tokenize,
  type MemoryIndexEntry,
} from './memory-search.js';

const entries: MemoryIndexEntry[] = [
  {
    id: 'a',
    title: 'Deploy process',
    summary: 'How we ship to prod',
    tags: ['deploy', 'ops'],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'b',
    title: 'Python style',
    summary: 'Prefer type hints',
    tags: ['python'],
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'c',
    title: 'Coffee order',
    summary: 'Oat latte',
    tags: ['prefs'],
    createdAt: '2026-01-03T00:00:00.000Z',
  },
];

test('tokenize lowercases, splits, and drops stopwords/short tokens', () => {
  assert.deepEqual(tokenize('The Deploy-Process to PROD'), [
    'deploy',
    'process',
    'prod',
  ]);
});

test('ranks tag matches above text-only matches', () => {
  const ranked = rankMemories('deploy', entries);
  assert.equal(ranked[0].entry.id, 'a');
  assert.ok(ranked[0].score >= 3);
});

test('a tag match outranks a text-only match for the same term', () => {
  const e: MemoryIndexEntry[] = [
    {
      id: 'tagged',
      title: 'x',
      summary: 'x',
      tags: ['deploy'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'texty',
      title: 'deploy deploy deploy',
      summary: '',
      tags: ['other'],
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  assert.equal(rankMemories('deploy', e)[0].entry.id, 'tagged');
});

test('returns only matching entries for a non-empty query', () => {
  const ranked = rankMemories('python', entries);
  assert.deepEqual(
    ranked.map((r) => r.entry.id),
    ['b'],
  );
});

test('empty query returns all entries in recency order', () => {
  const ranked = rankMemories('', entries);
  assert.deepEqual(
    ranked.map((r) => r.entry.id),
    ['c', 'b', 'a'],
  );
});

test('a query of only stopwords falls back to recency order', () => {
  const ranked = rankMemories('the it is', entries);
  assert.deepEqual(
    ranked.map((r) => r.entry.id),
    ['c', 'b', 'a'],
  );
});
