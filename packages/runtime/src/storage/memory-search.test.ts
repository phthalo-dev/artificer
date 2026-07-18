import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  rankMemories,
  tokenize,
  TAG_TOKEN_BOOST,
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
  // Tag boost is TAG_TOKEN_BOOST per matching tag token, plus Fuse similarity.
  assert.ok(ranked[0].score >= TAG_TOKEN_BOOST);
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

test('partial / near-miss title ranks above an unrelated exact token elsewhere', () => {
  const e: MemoryIndexEntry[] = [
    {
      id: 'near',
      title: 'Authentication JWT guide',
      summary: 'How sessions work',
      tags: ['security'],
      excerpt: 'signing tokens with HS256',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'unrelated',
      title: 'Lunch menu',
      summary: 'Catering for Friday',
      tags: ['office'],
      excerpt: 'authentication is not discussed here at all',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  // Typo / partial of "authentication" should still prefer the titled guide.
  const ranked = rankMemories('authentcation', e);
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].entry.id, 'near');
});

test('excerpt field participates in ranking', () => {
  const e: MemoryIndexEntry[] = [
    {
      id: 'body-hit',
      title: 'Ops note',
      summary: 'misc',
      tags: ['ops'],
      excerpt: 'rollback playbook for canary deploys',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'no-hit',
      title: 'Other',
      summary: 'nothing relevant',
      tags: ['misc'],
      excerpt: 'weather forecast',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const ranked = rankMemories('canary', e);
  assert.equal(ranked[0]?.entry.id, 'body-hit');
});
