import type { ExecutorConfig } from './api/types.js';

export function agentLabel(executor: ExecutorConfig | undefined): string {
  if (typeof executor === 'object' && executor.type === 'cli') {
    return executor.command;
  }
  if (typeof executor === 'object' && executor.type === 'acp') {
    if (executor.agent === 'opencode') return 'OpenCode (ACP)';
    const base = executor.command?.split(/[\\/]/).pop() || 'agent';
    return `${base} (ACP)`;
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
