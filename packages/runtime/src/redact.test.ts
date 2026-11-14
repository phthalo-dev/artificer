import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  redactExecutorConfig,
  redactRuntimeEvent,
  redactWorkstream,
} from './redact.js';

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

test('redactRuntimeEvent redacts workstream events only', () => {
  const ev = {
    kind: 'workstream',
    at: 't',
    data: { id: 'w', executor: { type: 'acp', command: 'x', env: { K: 'v' } } },
  };
  const out = redactRuntimeEvent(ev);
  assert.deepEqual((out.data as { executor: unknown }).executor, {
    type: 'acp',
    command: 'x',
    env: { K: '[redacted]' },
  });
  assert.equal(ev.data.executor.env.K, 'v');
  const other = {
    kind: 'run',
    at: 't',
    data: { executor: { env: { K: 'v' } } },
  };
  assert.equal(redactRuntimeEvent(other), other);
});
