import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  ageOutLearnBatches,
  learnBatchDir,
  mergeLearnBatches,
  trashLearnBatches,
  writeLearnBatch,
} from './learn-batches.js';

describe('learn-batches', () => {
  let execRoot: string;

  beforeEach(() => {
    execRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-learn-'));
  });

  afterEach(() => {
    fs.rmSync(execRoot, { recursive: true, force: true });
  });

  it('writes batch files and merges with kind aliases and entity dedupe', async () => {
    await writeLearnBatch(execRoot, 'run_1', 1, [
      {
        content: 'Always TDD in payments',
        title: 'TDD',
        kind: 'decision',
        tags: ['payments'],
      },
      {
        content: 'The payments-api service',
        title: 'payments-api',
        kind: 'entity',
      },
    ]);
    await writeLearnBatch(execRoot, 'run_1', 2, [
      {
        content: 'Duplicate entity',
        title: 'Payments-API',
        kind: 'entity',
      },
      {
        content: 'A note',
        kind: 'note',
        related: [
          { id: '', type: 'related' },
          { id: 'claim_x', type: 'related' },
        ],
      },
    ]);

    const merged = await mergeLearnBatches(execRoot, 'run_1');
    assert.equal(merged.length, 3);
    assert.equal(merged[0].kind, 'claim'); // decision → claim
    assert.equal(merged.filter((m) => m.kind === 'entity').length, 1);
    const note = merged.find((m) => m.kind === 'note');
    assert.deepEqual(note?.related, [{ id: 'claim_x', type: 'related' }]);
  });

  it('trashes the learn scratch directory', async () => {
    await writeLearnBatch(execRoot, 'run_2', 1, [
      { content: 'x', kind: 'note' },
    ]);
    const dir = learnBatchDir(execRoot, 'run_2');
    assert.ok(fs.existsSync(dir));
    await trashLearnBatches(execRoot, 'run_2');
    assert.equal(fs.existsSync(dir), false);
  });

  it('ages out abandoned learn-* directories older than maxAge', async () => {
    await writeLearnBatch(execRoot, 'old', 1, [
      { content: 'stale', kind: 'note' },
    ]);
    await writeLearnBatch(execRoot, 'fresh', 1, [
      { content: 'keep', kind: 'note' },
    ]);
    const oldDir = learnBatchDir(execRoot, 'old');
    const freshDir = learnBatchDir(execRoot, 'fresh');
    const oldMtime = Date.now() - 48 * 60 * 60 * 1000;
    fs.utimesSync(oldDir, oldMtime / 1000, oldMtime / 1000);

    const removed = await ageOutLearnBatches(
      execRoot,
      24 * 60 * 60 * 1000,
      Date.now(),
    );
    assert.equal(removed, 1);
    assert.equal(fs.existsSync(oldDir), false);
    assert.ok(fs.existsSync(freshDir));
  });
});
