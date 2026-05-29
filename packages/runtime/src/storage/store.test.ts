import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from './store.js';

async function tempStore(): Promise<{ store: Store; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dir);
  await store.init();
  return { store, dir };
}

test('addMemory then queryMemories recalls it; signpost counts it', async () => {
  const { store, dir } = await tempStore();
  try {
    await store.addMemory({ content: 'Deploys run on Tuesday', tags: ['deploy'] });
    const hits = await store.queryMemories('deploy');
    assert.equal(hits.length, 1);
    assert.match(hits[0].content, /Tuesday/);
    const sign = await store.memorySignpost();
    assert.match(sign ?? '', /1 memories/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a stale index.json is self-healed from the per-memory files', async () => {
  const { store, dir } = await tempStore();
  try {
    await store.addMemory({ content: 'one', tags: ['a'] });
    await store.addMemory({ content: 'two', tags: ['b'] });
    await store.addMemory({ content: 'three', tags: ['c'] });
    // Simulate a lost index entry (e.g. from a concurrent write race).
    const indexFile = path.join(dir, 'memories', 'index.json');
    const full = JSON.parse(await fs.readFile(indexFile, 'utf8'));
    await fs.writeFile(indexFile, JSON.stringify(full.slice(0, 1)), 'utf8');
    // Reconciled read paths must recover the full set.
    const sign = await store.memorySignpost();
    assert.match(sign ?? '', /3 memories/);
    const all = await store.queryMemories('');
    assert.equal(all.length, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('duplicate ids in the index are de-duplicated on reconcile', async () => {
  const { store, dir } = await tempStore();
  try {
    await store.addMemory({ content: 'solo', tags: ['x'] });
    const indexFile = path.join(dir, 'memories', 'index.json');
    const full = JSON.parse(await fs.readFile(indexFile, 'utf8'));
    await fs.writeFile(indexFile, JSON.stringify([...full, ...full]), 'utf8');
    const all = await store.queryMemories('');
    assert.equal(all.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
