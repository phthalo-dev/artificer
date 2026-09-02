import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  formatSectionsFooter,
  loadContextSections,
  renderSection,
  shortHash,
} from './context-sections.js';

async function tempFile(): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-context-sections-'),
  );
  return { dir, filePath: path.join(dir, 'context-sections.json') };
}

test('shortHash is 16-char sha256 hex', () => {
  const hash = shortHash('FINDINGS\n- a');
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(hash, shortHash('FINDINGS\n- a'));
  assert.notEqual(hash, shortHash('FINDINGS\n- b'));
});

test('renderSection replays exact body when hash matches', async () => {
  const { dir, filePath } = await tempFile();
  let computes = 0;
  try {
    const first = await renderSection({
      id: 'findings',
      filePath,
      compute: () => {
        computes++;
        return 'FINDINGS\n- a';
      },
      now: () => '2026-01-01T00:00:00.000Z',
    });
    assert.equal(first.updated, true);
    assert.equal(first.body, 'FINDINGS\n- a');
    const second = await renderSection({
      id: 'findings',
      filePath,
      compute: () => {
        computes++;
        return 'FINDINGS\n- a';
      },
    });
    assert.equal(second.updated, false);
    assert.equal(second.body, first.body);
    assert.equal(computes, 2); // compute still runs to produce hash input
    const stored = loadContextSections(filePath);
    assert.equal(
      stored.sections.findings?.updatedAt,
      '2026-01-01T00:00:00.000Z',
    );
    assert.equal(stored.sections.findings?.hash, shortHash('FINDINGS\n- a'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('changed body updates store', async () => {
  const { dir, filePath } = await tempFile();
  try {
    const first = await renderSection({
      id: 'findings',
      filePath,
      compute: () => 'FINDINGS\n- a',
      now: () => '2026-01-01T00:00:00.000Z',
    });
    assert.equal(first.updated, true);
    const second = await renderSection({
      id: 'findings',
      filePath,
      compute: () => 'FINDINGS\n- b',
      now: () => '2026-01-02T00:00:00.000Z',
    });
    assert.equal(second.updated, true);
    assert.equal(second.body, 'FINDINGS\n- b');
    const stored = loadContextSections(filePath);
    assert.equal(stored.version, 1);
    assert.equal(stored.sections.findings?.body, 'FINDINGS\n- b');
    assert.equal(stored.sections.findings?.hash, shortHash('FINDINGS\n- b'));
    assert.equal(
      stored.sections.findings?.updatedAt,
      '2026-01-02T00:00:00.000Z',
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('corrupt file recomputes', async () => {
  const { dir, filePath } = await tempFile();
  try {
    await fs.writeFile(filePath, 'not-json');
    const result = await renderSection({
      id: 'git_status',
      filePath,
      compute: () => 'STATUS',
      now: () => '2026-01-01T00:00:00.000Z',
    });
    assert.equal(result.updated, true);
    assert.equal(result.body, 'STATUS');
    const stored = loadContextSections(filePath);
    assert.equal(stored.sections.git_status?.body, 'STATUS');
    assert.equal(stored.sections.git_status?.hash, shortHash('STATUS'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('missing file starts empty and writes on first update', async () => {
  const { dir, filePath } = await tempFile();
  try {
    const empty = loadContextSections(filePath);
    assert.deepEqual(empty, { version: 1, sections: {} });
    await renderSection({
      id: 'file_cache',
      filePath,
      compute: () => 'hints',
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const stored = loadContextSections(filePath);
    assert.equal(stored.sections.file_cache?.body, 'hints');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('formatSectionsFooter', () => {
  assert.equal(formatSectionsFooter([]), '[context sections: all unchanged]');
  assert.equal(
    formatSectionsFooter(['git_status', 'findings']),
    '[context sections updated: git_status, findings]',
  );
});

test('save failure warns and still returns the computed body', async () => {
  const { dir } = await tempFile();
  const filePath = path.join(dir, 'not-a-dir');
  try {
    await fs.writeFile(filePath, 'block');
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const result = await renderSection({
        id: 'prior_runs',
        filePath: path.join(filePath, 'context-sections.json'),
        compute: () => 'DIGEST',
      });
      assert.equal(result.updated, true);
      assert.equal(result.body, 'DIGEST');
      assert.ok(
        warnings.some((w) => w.includes('failed to save context sections')),
      );
    } finally {
      console.warn = original;
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
