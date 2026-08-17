import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { IdentityStore } from '../storage/identity-store.js';
import { applyHistoryImport, planHistoryImport } from './import.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-import-'));
  tempDirs.push(dir);
  return dir;
}

function writeClaudeSession(
  root: string,
  project: string,
  id: string,
  text: string,
) {
  const dir = path.join(root, project);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    JSON.stringify({
      type: 'user',
      sessionId: id,
      cwd: '/Users/acme/app',
      message: { role: 'user', content: text },
    }) + '\n',
  );
}

test('planHistoryImport dry-run drafts preference memories and does not write', async () => {
  const sessions = tempDir();
  const identity = tempDir();
  writeClaudeSession(
    sessions,
    '-Users-acme-app',
    's1',
    'Always use pnpm, never npm.',
  );

  const plan = await planHistoryImport({
    identityDir: identity,
    sources: ['claude-code'],
    roots: { 'claude-code': sessions },
  });

  assert.equal(plan.scanned, 1);
  assert.equal(plan.drafts.length, 1);
  assert.equal(plan.drafts[0].kind, 'preference');
  assert.equal(plan.drafts[0].content, 'Always use pnpm, never npm.');
  assert.ok(plan.drafts[0].source.startsWith('import:claude-code:'));
  assert.ok(plan.drafts[0].sourceHash);
  assert.deepEqual(plan.drafts[0].tags, ['imported', 'claude-code']);
  assert.equal(
    fs.existsSync(path.join(identity, 'identity', 'memories')),
    false,
  );
});

test('applyHistoryImport writes drafts via IdentityStore', async () => {
  const sessions = tempDir();
  const identity = tempDir();
  writeClaudeSession(
    sessions,
    '-Users-acme-app',
    's1',
    'Never commit directly to main.',
  );

  const plan = await planHistoryImport({
    identityDir: identity,
    sources: ['claude-code'],
    roots: { 'claude-code': sessions },
  });
  const written = await applyHistoryImport(identity, plan.drafts);

  assert.equal(written.length, 1);
  const store = new IdentityStore(identity);
  const memories = await store.listMemories();
  assert.equal(memories.length, 1);
  assert.equal(memories[0].kind, 'preference');
  assert.equal(memories[0].content, 'Never commit directly to main.');
  assert.equal(memories[0].sourceHash, plan.drafts[0].sourceHash);
});

test('planHistoryImport skips drafts already present by sourceHash', async () => {
  const sessions = tempDir();
  const identity = tempDir();
  writeClaudeSession(
    sessions,
    '-Users-acme-app',
    's1',
    'I prefer bun over npm for scripts.',
  );

  const first = await planHistoryImport({
    identityDir: identity,
    sources: ['claude-code'],
    roots: { 'claude-code': sessions },
  });
  await applyHistoryImport(identity, first.drafts);

  const second = await planHistoryImport({
    identityDir: identity,
    sources: ['claude-code'],
    roots: { 'claude-code': sessions },
  });
  assert.equal(second.drafts.length, 0);
  assert.equal(second.skippedExisting, 1);
});
