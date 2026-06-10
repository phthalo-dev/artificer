import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

/** Structured blocked signal — satisfies worker completion requirement without declare_done. */
export function createDeclareBlockedTool(_ctx: ToolContext): ToolDef {
  return {
    name: 'declare_blocked',
    description:
      'Call when you cannot complete the task after reasonable attempts. Requires a reason ' +
      'and summary of what you tried. Use instead of declare_done when stuck.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why the task cannot be completed.' },
        attemptsSummary: {
          type: 'string',
          description: 'What you tried and what failed or blocked progress.',
        },
      },
      required: ['reason', 'attemptsSummary'],
    },
    handler: async (input) => {
      const reason = String(input.reason ?? '').trim();
      const attempts = String(input.attemptsSummary ?? '').trim();
      if (!reason) throw new Error('reason is required');
      if (!attempts) throw new Error('attemptsSummary is required');
      return `BLOCKED: ${reason}\nAttempts: ${attempts}`;
    },
  };
}
