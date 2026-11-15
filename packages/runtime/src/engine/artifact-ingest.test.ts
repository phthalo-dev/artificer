import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { ingestPublishedArtifacts } from './artifact-ingest.js';

test('ingest publishes valid lines and deletes the file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-ingest-'));
  const file = path.join(dir, '.artificer-artifacts.jsonl');
  await fs.writeFile(
    file,
    [
      JSON.stringify({ key: 'note', name: 'Note', content: 'hello' }),
      'not json',
      JSON.stringify({ key: 'skip' }),
    ].join('\n'),
  );
  const published: string[] = [];
  const count = await ingestPublishedArtifacts(dir, async (input) => {
    published.push(input.key);
  });
  assert.equal(count, 1);
  assert.deepEqual(published, ['note']);
  await assert.rejects(fs.access(file));
});

test('ingest continues after one artifact fails to publish', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-ingest-'));
  const file = path.join(dir, '.artificer-artifacts.jsonl');
  await fs.writeFile(
    file,
    [
      JSON.stringify({ key: 'bad', name: 'Bad', content: 'invalid' }),
      JSON.stringify({ key: 'good', name: 'Good', content: 'valid' }),
    ].join('\n'),
  );
  const published: string[] = [];
  const count = await ingestPublishedArtifacts(dir, async (input) => {
    if (input.key === 'bad') throw new Error('invalid artifact');
    published.push(input.key);
  });

  assert.equal(count, 1);
  assert.deepEqual(published, ['good']);
  assert.equal(
    await fs.readFile(file, 'utf8'),
    `${JSON.stringify({ key: 'bad', name: 'Bad', content: 'invalid' })}\n`,
  );
});
