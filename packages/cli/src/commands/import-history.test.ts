import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'vitest';
import { importHistory } from './import-history.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-cli-import-'));
  tempDirs.push(dir);
  return dir;
}

function captureLog(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '));
  };
  return fn()
    .then(() => chunks.join('\n'))
    .finally(() => {
      console.log = original;
    });
}

function writeClaudeSession(root: string, text: string): void {
  const project = path.join(root, '-Users-acme-app');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, 's1.jsonl'),
    JSON.stringify({
      type: 'user',
      sessionId: 's1',
      cwd: '/Users/acme/app',
      message: { role: 'user', content: text },
    }) + '\n',
  );
}

test('import-history dry-run prints drafts and does not write memories', async () => {
  const sessions = tempDir();
  const identity = tempDir();
  writeClaudeSession(sessions, 'Always use pnpm, never npm.');

  const output = await captureLog(() =>
    importHistory([
      '--source',
      'claude-code',
      '--root',
      `claude-code:${sessions}`,
      '--identity-dir',
      identity,
    ]),
  );

  assert.match(output, /Always use pnpm, never npm/);
  assert.match(output, /Dry-run/);
  assert.equal(
    fs.existsSync(path.join(identity, 'identity', 'memories')),
    false,
  );
});

test('import-history --apply writes preference memories', async () => {
  const sessions = tempDir();
  const identity = tempDir();
  writeClaudeSession(sessions, 'Never commit directly to main.');

  const output = await captureLog(() =>
    importHistory([
      '--source',
      'claude-code',
      '--root',
      `claude-code:${sessions}`,
      '--identity-dir',
      identity,
      '--apply',
    ]),
  );

  assert.match(output, /Wrote 1 memory/);
  const memoriesDir = path.join(identity, 'identity', 'memories');
  const files = fs.readdirSync(memoriesDir).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, 1);
  const body = fs.readFileSync(path.join(memoriesDir, files[0]), 'utf-8');
  assert.match(body, /Never commit directly to main/);
  assert.match(body, /kind: "preference"/);
});

test('import-history rejects an unknown source', async () => {
  await assert.rejects(
    () => importHistory(['--source', 'windsurf']),
    /Unknown source/,
  );
});
