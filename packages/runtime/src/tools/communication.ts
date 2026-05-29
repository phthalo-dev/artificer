import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

/** Reply to the outside world. Available to the communicator and orchestrator. */
export function createReplyTool(ctx: ToolContext): ToolDef[] {
  const { engine, run } = ctx;
  return [
    {
      name: 'reply',
      description:
        'Send a message back to the person who is talking to you. Use this to answer questions, report status, confirm work started, or notify that a workstream finished.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The message to send.' },
        },
        required: ['content'],
      },
      handler: async (input) => {
        await engine.reply(String(input.content), run.workstreamId);
        return 'Reply sent.';
      },
    },
  ];
}

/** Communicator-only tools for starting and steering workstreams. */
export function createCommunicatorTools(ctx: ToolContext): ToolDef[] {
  const { engine, run } = ctx;
  const { store } = engine;

  return [
    {
      name: 'start_workstream',
      description:
        'Kick off a new body of work as its own workstream. This creates the workstream and hands it to an orchestrator call that will plan and execute it asynchronously.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title for the work.' },
          goal: {
            type: 'string',
            description: 'The full objective / request driving this work.',
          },
          repoUrl: {
            type: 'string',
            description: 'Optional repository the work targets.',
          },
        },
        required: ['title', 'goal'],
      },
      handler: async (input) => {
        const ws = await engine.startWorkstream({
          title: String(input.title),
          goal: String(input.goal),
          repoUrl: input.repoUrl ? String(input.repoUrl) : undefined,
          parentRunId: run.id,
          originMessageId: run.originMessageId,
        });
        return `Started workstream ${ws.id} ("${ws.title}"). An orchestrator is now planning it.`;
      },
    },
    {
      name: 'send_note',
      description:
        'Send a steering note into an existing workstream (e.g. a new requirement or a correction). This appends to the workstream summary and re-invokes its orchestrator.',
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: { type: 'string', description: 'Target workstream id.' },
          note: { type: 'string', description: 'The note / instruction.' },
        },
        required: ['workstreamId', 'note'],
      },
      handler: async (input) => {
        const workstreamId = String(input.workstreamId);
        const ws = await store.getWorkstream(workstreamId);
        if (!ws) return `Error: workstream ${workstreamId} not found.`;
        const note = String(input.note);
        await store.updateWorkstream(workstreamId, {
          summary: `${ws.summary}\n\n[User note] ${note}`.trim(),
        });
        await engine.spawnCall({
          role: 'orchestrator',
          description: `The user sent a note for this workstream: "${note}". Re-assess the plan and decide what to do next.`,
          workstreamId,
          parentRunId: run.id,
          originMessageId: run.originMessageId,
        });
        return `Note delivered to workstream ${workstreamId}; orchestrator re-invoked.`;
      },
    },
    {
      name: 'learn',
      description:
        'Hand off a link or piece of content for the agent to read and remember. Use when the person is teaching you something or sharing reference material to keep.',
      inputSchema: {
        type: 'object',
        properties: {
          material: {
            type: 'string',
            description: 'The URL to read, or the raw content to learn from.',
          },
          note: {
            type: 'string',
            description: 'Optional instruction about what to focus on.',
          },
        },
        required: ['material'],
      },
      handler: async (input) => {
        const material = String(input.material);
        const focus = input.note ? `\nFocus: ${String(input.note)}` : '';
        const { runId } = await engine.spawnCall({
          role: 'librarian',
          description: `Learn from this and save what matters to memory:\n${material}${focus}`,
          parentRunId: run.id,
          originMessageId: run.originMessageId,
        });
        return `Librarian call ${runId} started; it will read and remember this in the background.`;
      },
    },
  ];
}
