import { describe, expect, it } from 'vitest';
import { agentLabel } from './format-agent';

describe('agentLabel', () => {
  it('falls back to the built-in loop for string executors', () => {
    expect(agentLabel(undefined)).toBe('Built-in loop');
    expect(agentLabel('llm')).toBe('Built-in loop');
  });

  it('names the known agents', () => {
    expect(agentLabel('claude-code')).toBe('Claude Code');
    expect(agentLabel('cursor-agent')).toBe('Cursor');
    expect(agentLabel('opencode')).toBe('OpenCode');
  });

  it('uses the CLI command as the label for cli executors', () => {
    expect(
      agentLabel({
        type: 'cli',
        command: 'qwen',
        args: [],
        promptMode: 'stdin',
      }),
    ).toBe('qwen');
  });
});
