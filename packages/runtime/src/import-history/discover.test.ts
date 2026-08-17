import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { listSessions } from './discover.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-discover-'));
  tempDirs.push(dir);
  return dir;
}

test('lists Claude Code parent sessions and skips subagents', () => {
  const root = tempDir();
  const project = path.join(root, '-Users-acme-app');
  fs.mkdirSync(path.join(project, 'sid', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(project, 'abc.jsonl'), '{"type":"user"}\n');
  fs.writeFileSync(path.join(project, 'agent-zzz.jsonl'), '{"type":"user"}\n');
  fs.writeFileSync(
    path.join(project, 'sid', 'subagents', 'agent-www.jsonl'),
    '{"type":"user"}\n',
  );

  const items = listSessions({
    sources: ['claude-code'],
    roots: { 'claude-code': root },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'abc');
  assert.equal(items[0].source, 'claude-code');
});

test('lists Cursor agent transcripts', () => {
  const root = tempDir();
  const transcripts = path.join(
    root,
    'Users-acme-app',
    'agent-transcripts',
    'sess-1',
  );
  fs.mkdirSync(transcripts, { recursive: true });
  fs.writeFileSync(path.join(transcripts, 'sess-1.jsonl'), '{"role":"user"}\n');

  const items = listSessions({
    sources: ['cursor'],
    roots: { cursor: root },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'sess-1');
  assert.equal(items[0].source, 'cursor');
});

test('lists Codex rollout jsonl files recursively', () => {
  const root = tempDir();
  const nested = path.join(root, '2026', '08', '17');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    path.join(nested, 'rollout-sess-9.jsonl'),
    '{"type":"session_meta"}\n',
  );

  const items = listSessions({
    sources: ['codex'],
    roots: { codex: root },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'rollout-sess-9');
});

test('lists OpenCode session export files', () => {
  const root = tempDir();
  fs.writeFileSync(
    path.join(root, 'oc.json'),
    JSON.stringify({
      info: { id: 'ses_1', directory: '/Users/acme/app' },
      messages: [],
    }),
  );

  const items = listSessions({
    sources: ['opencode'],
    roots: { opencode: root },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'ses_1');
  assert.equal(items[0].cwd, '/Users/acme/app');
});

test('filters sessions to a project directory', () => {
  const root = tempDir();
  const keep = path.join(root, '-Users-acme-app');
  const drop = path.join(root, '-Users-other');
  fs.mkdirSync(keep, { recursive: true });
  fs.mkdirSync(drop, { recursive: true });
  fs.writeFileSync(path.join(keep, 'keep.jsonl'), '{"type":"user"}\n');
  fs.writeFileSync(path.join(drop, 'drop.jsonl'), '{"type":"user"}\n');

  const items = listSessions({
    sources: ['claude-code'],
    roots: { 'claude-code': root },
    projectDir: '/Users/acme/app',
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'keep');
});

test('returns empty when a source root is missing', () => {
  const items = listSessions({
    sources: ['codex'],
    roots: { codex: path.join(os.tmpdir(), 'artificer-missing-codex') },
  });
  assert.deepEqual(items, []);
});
