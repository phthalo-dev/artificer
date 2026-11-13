import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactExecutorConfig, redactWorkstream } from './redact.js';

test('redactExecutorConfig masks env values and keeps keys and other fields', () => {
  const input = {
    type: 'acp' as const,
    agent: 'codex' as const,
    model: 'm',
    env: { CODEX_API_KEY: 'sk-secret', FOO: 'bar' },
  };
  const out = redactExecutorConfig(input);
  assert.deepEqual(out, {
    type: 'acp',
    agent: 'codex',
    model: 'm',
    env: { CODEX_API_KEY: '[redacted]', FOO: '[redacted]' },
  });
  assert.equal(input.env.CODEX_API_KEY, 'sk-secret');
});

test('redactExecutorConfig passes through strings, null, undefined and env-less configs', () => {
  assert.equal(redactExecutorConfig('llm'), 'llm');
  assert.equal(redactExecutorConfig(null), null);
  assert.equal(redactExecutorConfig(undefined), undefined);
  const plain = { type: 'acp' as const, agent: 'opencode' as const };
  assert.equal(redactExecutorConfig(plain), plain);
});

test('redactWorkstream redacts only the executor', () => {
  const ws = {
    id: 'w',
    executor: { type: 'acp' as const, command: 'x', args: [], env: { K: 'v' } },
  };
  assert.deepEqual(redactWorkstream(ws).executor.env, { K: '[redacted]' });
  const none = { id: 'w' };
  assert.equal(redactWorkstream(none), none);
});
