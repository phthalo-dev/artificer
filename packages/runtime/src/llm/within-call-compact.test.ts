import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage } from 'ai';
import { SUMMARY_PREFIX } from '../engine/agentic-compact.js';
import { DEFAULT_WITHIN_CALL_COMPACTION } from '../engine/compaction-config.js';
import {
  assessWithinCallCompactionTier,
  rebuildMessagesAfterCompaction,
  serializeMessagesForSummary,
  splitMessagesForCompaction,
} from './within-call-compact.js';

test('assessWithinCallCompactionTier respects thresholds', () => {
  const config = DEFAULT_WITHIN_CALL_COMPACTION;
  assert.equal(
    assessWithinCallCompactionTier(config.softThresholdChars - 1, config),
    'none',
  );
  assert.equal(
    assessWithinCallCompactionTier(config.softThresholdChars, config),
    'soft',
  );
  assert.equal(
    assessWithinCallCompactionTier(config.hardThresholdChars, config),
    'hard',
  );
});

test('splitMessagesForCompaction preserves task and recent tail', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: 'step 1' },
    { role: 'assistant', content: 'step 2' },
    { role: 'assistant', content: 'step 3' },
    { role: 'assistant', content: 'step 4' },
  ];
  const { preserve, head, tail } = splitMessagesForCompaction(messages, 2);
  assert.equal(preserve.length, 1);
  assert.equal(preserve[0]!.content, 'task');
  assert.equal(head.length, 2);
  assert.equal(tail.length, 2);
  assert.equal((tail[1] as { content: string }).content, 'step 4');
});

test('serializeMessagesForSummary includes roles and tool results', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'fix bug' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'read_file',
          input: { path: 'a.ts' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'read_file',
          output: { type: 'text', value: 'file body' },
        },
      ],
    },
  ];
  const text = serializeMessagesForSummary(messages);
  assert.match(text, /fix bug/);
  assert.match(text, /read_file/);
  assert.match(text, /file body/);
});

test('rebuildMessagesAfterCompaction injects summary user message', () => {
  const preserve: ModelMessage[] = [{ role: 'user', content: 'task' }];
  const tail: ModelMessage[] = [{ role: 'assistant', content: 'recent' }];
  const rebuilt = rebuildMessagesAfterCompaction(preserve, 'did X', tail);
  assert.equal(rebuilt.length, 3);
  const summary = rebuilt[1]!.content as string;
  assert.ok(summary.startsWith(SUMMARY_PREFIX.trim().slice(0, 20)));
  assert.match(summary, /did X/);
  assert.equal((rebuilt[2] as { content: string }).content, 'recent');
});
