import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cosineSimilarity,
  localEmbed,
  rankMemoriesHybrid,
} from './memory-embeddings.js';
import type { MemoryIndexEntry } from './memory-search.js';
import { rankMemories } from './memory-search.js';

test('localEmbed is deterministic and normalized', () => {
  const a = localEmbed('payments tdd claim');
  const b = localEmbed('payments tdd claim');
  assert.deepEqual(a, b);
  const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6);
});

test('cosineSimilarity is 1 for identical vectors', () => {
  const v = localEmbed('hello world');
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-6);
});

test('rankMemoriesHybrid falls back to lexical when vectors empty', () => {
  const entries: MemoryIndexEntry[] = [
    {
      id: 'a',
      title: 'Deploy',
      tags: ['ops'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const hybrid = rankMemoriesHybrid(
    'deploy',
    entries,
    {},
    localEmbed('deploy'),
  );
  const lexical = rankMemories('deploy', entries);
  assert.equal(hybrid[0]?.entry.id, lexical[0]?.entry.id);
});

test('rankMemoriesHybrid fuses semantic signal when vectors present', () => {
  const entries: MemoryIndexEntry[] = [
    {
      id: 'near',
      title: 'Auth JWT',
      summary: 'token signing',
      tags: ['security'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'far',
      title: 'Lunch menu',
      summary: 'catering',
      tags: ['office'],
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const vectors = {
    near: localEmbed('Auth JWT token signing security'),
    far: localEmbed('Lunch menu catering office'),
  };
  const ranked = rankMemoriesHybrid(
    'authentication jwt',
    entries,
    vectors,
    localEmbed('authentication jwt'),
  );
  assert.equal(ranked[0]?.entry.id, 'near');
});
