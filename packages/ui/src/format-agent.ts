import type { ExecutorConfig } from './api/types.js';

/** Canonical display labels for executor types — single source of truth for the agent pickers. */
export const EXECUTOR_LABELS: Record<string, string> = {
  llm: 'Built-in loop',
  'claude-code': 'Claude Code',
  'cursor-agent': 'Cursor',
  opencode: 'OpenCode',
};

export function agentLabel(executor: ExecutorConfig | undefined): string {
  if (typeof executor === 'object' && executor.type === 'cli') {
    return executor.command;
  }
  const type = typeof executor === 'string' ? executor : executor?.type;
  switch (type) {
    case 'claude-code':
      return 'Claude Code';
    case 'cursor-agent':
      return 'Cursor';
    case 'opencode':
      return 'OpenCode';
    case 'llm':
    default:
      return 'Built-in loop';
  }
}
