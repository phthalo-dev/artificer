import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationPrompt } from './conversation-prompt.js';

test('resume sends only the new message', () => {
  const text = conversationPrompt({
    preamble: 'PRE',
    prior: [{ direction: 'inbound', content: 'old' }],
    content: 'new',
    resume: true,
  });
  assert.equal(text, 'new');
});

test('replay keeps the newest prior messages inside the cap', () => {
  const prior = [
    { direction: 'inbound' as const, content: 'a'.repeat(30_000) },
    { direction: 'outbound' as const, content: 'b'.repeat(20_000) },
  ];
  const text = conversationPrompt({
    preamble: 'PRE',
    prior,
    content: 'now',
    resume: false,
  });
  assert.ok(text.startsWith('PRE\n\n'));
  assert.ok(text.endsWith('[User]: now'));
  assert.equal(text.includes('a'.repeat(30_000)), false);
  assert.ok(text.includes('b'.repeat(20_000)));
});

test('a single oversized prior message keeps its tail', () => {
  const prior = [
    { direction: 'outbound' as const, content: 'x'.repeat(50_000) },
  ];
  const text = conversationPrompt({
    preamble: 'PRE',
    prior,
    content: 'now',
    resume: false,
  });
  const body = text.split('[Agent]: ')[1].split('\n\n[User]: now')[0];
  assert.equal(body.length, 40_000);
  assert.ok(body.endsWith('x'));
});
