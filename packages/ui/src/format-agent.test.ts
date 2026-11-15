import assert from 'node:assert/strict';
import { test } from 'vitest';
import { agentLabel } from './format-agent.js';

test('agentLabel names the shortcuts', () => {
  assert.equal(agentLabel(undefined), 'Built-in loop');
  assert.equal(agentLabel('llm'), 'Built-in loop');
  assert.equal(agentLabel('claude-code'), 'Claude Code');
  assert.equal(agentLabel('cursor-agent'), 'Cursor');
  assert.equal(agentLabel('opencode'), 'OpenCode');
  assert.equal(
    agentLabel({
      type: 'cli',
      command: 'qwen',
      args: [],
      promptMode: 'stdin',
    }),
    'qwen',
  );
});
