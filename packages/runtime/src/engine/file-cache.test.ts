import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileCache } from './file-cache.js';
import { Layout } from '../storage/layout.js';

test('LRU evicts oldest when over max entries', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-file-cache-test-'));
  try {
    const layout = new Layout(dir);
    const wsId = 'ws_lru';
    const cache = await FileCache.load(layout, wsId, 2);
    cache.recordRead('a.ts', 1, 'alpha');
    cache.recordRead('b.ts', 2, 'beta');
    cache.recordRead('c.ts', 3, 'gamma');
    await cache.save();

    const reloaded = await FileCache.load(layout, wsId, 2);
    const block = reloaded.formatHintBlock();
    assert.ok(block);
    assert.ok(block!.includes('b.ts'));
    assert.ok(block!.includes('c.ts'));
    assert.ok(!block!.includes('a.ts'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
