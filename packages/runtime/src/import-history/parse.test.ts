import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'vitest';
import { parseSession } from './parse.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeTemp(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-parse-'));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

test('parses Claude Code user text and skips tool results, sidechains, and noise', () => {
  const file = writeTemp(
    'session.jsonl',
    [
      JSON.stringify({
        type: 'user',
        sessionId: 'cc-1',
        cwd: '/repo',
        message: { role: 'user', content: 'Always use pnpm.' },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', content: 'Always ignore tool output.' },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        isSidechain: true,
        message: { content: 'Always ignore sidechain.' },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: '<command-name>/clear</command-name>' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Always use npm.' }] },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'text', text: 'Never commit to main.' }],
        },
      }),
      '',
    ].join('\n'),
  );

  const parsed = parseSession({
    source: 'claude-code',
    id: 'cc-1',
    path: file,
  });
  assert.equal(parsed.cwd, '/repo');
  assert.deepEqual(parsed.userTexts, [
    'Always use pnpm.',
    'Never commit to main.',
  ]);
});

test('parses Cursor user_query text and ignores tool calls', () => {
  const file = writeTemp(
    'cursor.jsonl',
    [
      JSON.stringify({
        role: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: '<timestamp>now</timestamp>\n<user_query>\nI prefer bun.\n</user_query>',
            },
          ],
        },
      }),
      JSON.stringify({
        role: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: { path: '/x' } }],
        },
      }),
      '',
    ].join('\n'),
  );

  const parsed = parseSession({
    source: 'cursor',
    id: 'cur-1',
    path: file,
  });
  assert.deepEqual(parsed.userTexts, ['I prefer bun.']);
});

test('parses Codex user messages and drops injected context', () => {
  const file = writeTemp(
    'rollout.jsonl',
    [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'cdx-1', cwd: '/workspace' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Always run tests first.' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '<environment_context>cwd=/tmp</environment_context>',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"pwd"}',
        },
      }),
      '',
    ].join('\n'),
  );

  const parsed = parseSession({
    source: 'codex',
    id: 'cdx-1',
    path: file,
  });
  assert.equal(parsed.id, 'cdx-1');
  assert.equal(parsed.cwd, '/workspace');
  assert.deepEqual(parsed.userTexts, ['Always run tests first.']);
});

test('parses OpenCode export user text parts', () => {
  const file = writeTemp(
    'session.json',
    JSON.stringify({
      info: { id: 'oc-1', directory: '/app' },
      messages: [
        {
          info: { role: 'user' },
          parts: [{ type: 'text', text: 'Never push to main.' }],
        },
        {
          info: { role: 'assistant' },
          parts: [
            { type: 'tool', tool: 'read', state: { input: { path: 'a' } } },
            { type: 'text', text: 'Always use npm.' },
          ],
        },
      ],
    }),
  );

  const parsed = parseSession({
    source: 'opencode',
    id: 'oc-1',
    path: file,
  });
  assert.equal(parsed.cwd, '/app');
  assert.deepEqual(parsed.userTexts, ['Never push to main.']);
});

test('parses OpenCode file-store session + message + part layout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-parse-'));
  tempDirs.push(dir);
  const sessionDir = path.join(dir, 'session', 'proj_1');
  const messageDir = path.join(dir, 'message', 'ses_1');
  const partDir = path.join(dir, 'part', 'msg_1');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(messageDir, { recursive: true });
  fs.mkdirSync(partDir, { recursive: true });
  const sessionPath = path.join(sessionDir, 'ses_1.json');
  fs.writeFileSync(
    sessionPath,
    JSON.stringify({ id: 'ses_1', directory: '/app' }),
  );
  fs.writeFileSync(
    path.join(messageDir, 'msg_1.json'),
    JSON.stringify({ id: 'msg_1', role: 'user' }),
  );
  fs.writeFileSync(
    path.join(partDir, 'prt_1.json'),
    JSON.stringify({ type: 'text', text: 'Always run the test suite.' }),
  );

  const parsed = parseSession({
    source: 'opencode',
    id: 'ses_1',
    path: sessionPath,
  });
  assert.equal(parsed.cwd, '/app');
  assert.deepEqual(parsed.userTexts, ['Always run the test suite.']);
});
