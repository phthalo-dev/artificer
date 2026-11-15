import { expect, test } from 'vitest';
import { agentLabel } from './format-agent.js';

test('agentLabel names the shortcuts', () => {
  expect(agentLabel(undefined)).toBe('Built-in loop');
  expect(agentLabel('llm')).toBe('Built-in loop');
  expect(agentLabel('claude-code')).toBe('Claude Code');
  expect(agentLabel('cursor-agent')).toBe('Cursor');
  expect(agentLabel('opencode')).toBe('OpenCode');
  expect(
    agentLabel({
      type: 'cli',
      command: 'qwen',
      args: [],
      promptMode: 'stdin',
    }),
  ).toBe('qwen');
});

test('agentLabel names ACP presets and custom commands', () => {
  expect(agentLabel({ type: 'acp', agent: 'opencode' })).toBe('OpenCode (ACP)');
  expect(agentLabel({ type: 'acp', agent: 'codex' })).toBe('Codex (ACP)');
  expect(agentLabel({ type: 'acp', command: '/x/gemini', args: [] })).toBe(
    'gemini (ACP)',
  );
});
