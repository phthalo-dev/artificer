import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('agentLabel names ACP presets and custom commands', () => {
  assert.equal(
    agentLabel({ type: 'acp', agent: 'opencode' }),
    'OpenCode (ACP)',
  );
  assert.equal(
    agentLabel({ type: 'acp', command: '/x/gemini', args: [] }),
    'gemini (ACP)',
  );
});
