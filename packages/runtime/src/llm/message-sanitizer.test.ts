import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage } from 'ai';
import {
  enforceTotalTextBudget,
  invalidateOutdatedReads,
  microcompactOldToolResults,
  OUTDATED_FILE_CONTENT,
  sanitizeMessagesForStep,
  truncateToolResults,
} from './message-sanitizer.js';

function toolResultText(value: string) {
  return { type: 'text' as const, value };
}

test('earlier read_file result replaced when same path re-read later', () => {
  const messages = [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'a1',
          toolName: 'read_file',
          input: { path: 'src/foo.ts' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'a1',
          toolName: 'read_file',
          output: toolResultText('old content'),
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'a2',
          toolName: 'read_file',
          input: { path: 'src/foo.ts' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'a2',
          toolName: 'read_file',
          output: toolResultText('new content'),
        },
      ],
    },
  ] as ModelMessage[];

  const out = invalidateOutdatedReads(messages);
  const first = out[1]!.content as Array<{ output: { value: string } }>;
  assert.equal(first[0]!.output.value, OUTDATED_FILE_CONTENT);
  const second = out[3]!.content as Array<{ output: { value: string } }>;
  assert.match(second[0]!.output.value, /new content/);
});

test('invalidateOutdatedReads handles JSON string tool-call input', () => {
  const messages = [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'a1',
          toolName: 'read_file',
          input: JSON.stringify({ path: 'src/bar.ts' }),
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'a1',
          toolName: 'read_file',
          output: 'first read',
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'a2',
          toolName: 'read_file',
          input: { file_path: 'src/bar.ts' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'a2',
          toolName: 'read_file',
          output: toolResultText('second read'),
        },
      ],
    },
  ] as ModelMessage[];

  const out = invalidateOutdatedReads(messages);
  const first = out[1]!.content as unknown as Array<{ output: { value: string } }>;
  assert.equal(first[0]!.output.value, OUTDATED_FILE_CONTENT);
});

test('truncateToolResults truncates long output', () => {
  const longText = 'x'.repeat(200);
  const messages = [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'grep',
          output: toolResultText(longText),
        },
      ],
    },
  ] as ModelMessage[];

  const out = truncateToolResults(messages, 50);
  const result = out[0]!.content as Array<{ output: { value: string } }>;
  assert.ok(result[0]!.output.value.length <= 50);
  assert.match(result[0]!.output.value, /truncated/);
});

test('enforceTotalTextBudget reduces oversized messages', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'grep',
          output: toolResultText('a'.repeat(5_000)),
        },
        {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'grep',
          output: toolResultText('b'.repeat(4_000)),
        },
      ],
    },
  ] as ModelMessage[];

  const out = enforceTotalTextBudget(messages, 2_000);
  const results = out[1]!.content as Array<{ output: { value: string } }>;
  const total =
    'hello'.length +
    results[0]!.output.value.length +
    results[1]!.output.value.length;
  assert.ok(total <= 2_000);
  assert.ok(results[0]!.output.value.length < 5_000);
  assert.ok(results[1]!.output.value.length < 4_000);
});

test('sanitizeMessagesForStep respects outdatedReadInvalidation=false', () => {
  const messages = [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'a1',
          toolName: 'read_file',
          input: { path: 'src/foo.ts' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'a1',
          toolName: 'read_file',
          output: toolResultText('old content'),
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'a2',
          toolName: 'read_file',
          input: { path: 'src/foo.ts' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'a2',
          toolName: 'read_file',
          output: toolResultText('new content'),
        },
      ],
    },
  ] as ModelMessage[];

  const out = sanitizeMessagesForStep(messages, {
    maxToolResultChars: 50_000,
    maxTotalTextChars: 500_000,
    outdatedReadInvalidation: false,
  });
  const first = out[1]!.content as Array<{ output: { value: string } }>;
  assert.match(first[0]!.output.value, /old content/);
});

test('microcompactOldToolResults clears older compactable tool outputs', () => {
  const messages = [
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'grep', input: { pattern: 'a' } },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'grep', input: { pattern: 'b' } },
        { type: 'tool-call', toolCallId: 'c3', toolName: 'grep', input: { pattern: 'c' } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'c1', toolName: 'grep', output: toolResultText('one') },
        { type: 'tool-result', toolCallId: 'c2', toolName: 'grep', output: toolResultText('two') },
        { type: 'tool-result', toolCallId: 'c3', toolName: 'grep', output: toolResultText('three') },
      ],
    },
  ] as ModelMessage[];

  const out = microcompactOldToolResults(messages, 2);
  const results = out[1]!.content as Array<{ output: { value: string } }>;
  assert.match(results[0]!.output.value, /cleared/i);
  assert.match(results[1]!.output.value, /two/);
  assert.match(results[2]!.output.value, /three/);
});

test('sanitizeMessagesForStep does not mutate input messages', () => {
  const messages = [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'grep',
          output: toolResultText('x'.repeat(200)),
        },
      ],
    },
  ] as ModelMessage[];

  const original = (messages[0]!.content as Array<{ output: { value: string } }>)[0]!
    .output.value;
  sanitizeMessagesForStep(messages, {
    maxToolResultChars: 50,
    maxTotalTextChars: 500_000,
    outdatedReadInvalidation: true,
  });
  const unchanged = (messages[0]!.content as Array<{ output: { value: string } }>)[0]!
    .output.value;
  assert.equal(unchanged, original);
});
