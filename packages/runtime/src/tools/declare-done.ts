import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

/** Bench completion tool: the run cannot finish without a verified declare_done call. */
export function createDeclareDoneTool(ctx: ToolContext): ToolDef {
  return {
    name: 'declare_done',
    description:
      'Call when the task is verified complete. Requires summary, verified=true, and ' +
      'the testsRun command you executed. The run cannot finish without this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One-line summary of what changed.' },
        verified: {
          type: 'boolean',
          description:
            'True only after running the relevant test/build command and confirming success.',
        },
        testsRun: {
          type: 'string',
          description: 'Exact test or build command you ran to verify (e.g. "pytest tests/foo.py").',
        },
      },
      required: ['summary', 'verified'],
    },
    handler: async (input) => {
      const summary = String(input.summary ?? '').trim();
      if (!summary) throw new Error('summary is required');
      if (input.verified !== true) {
        throw new Error(
          'verified must be true — run the relevant tests first, or end with BLOCKED if stuck',
        );
      }
      const testsRun = String(input.testsRun ?? '').trim();
      const testsNote = testsRun ? ` (tests: ${testsRun})` : '';
      return `DONE: ${summary}${testsNote}`;
    },
  };
}
