import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import {
  isRepoTaskMessage,
  looksLikeRepoSource,
  parseWorkstreamHeader,
} from '../engine/task-intent.js';

/** Conversation history tool — lets the communicator look back when the thread gets long. */
export function createMessageHistoryTools(ctx: ToolContext): ToolDef[] {
  const { engine } = ctx;
  return [
    {
      name: 'get_recent_messages',
      description:
        'Search and retrieve messages from the conversation thread. Supports full-text search, date range filtering, pagination by index, and direction filtering. Use when you need to find something specific from earlier in the conversation or page through history.',
      inputSchema: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description:
              'Case-insensitive substring to search for in message content.',
          },
          direction: {
            type: 'string',
            enum: ['inbound', 'outbound', 'all'],
            description: 'Filter by message direction. Defaults to "all".',
          },
          after: {
            type: 'string',
            description:
              'ISO 8601 timestamp — only return messages created after this time.',
          },
          before: {
            type: 'string',
            description:
              'ISO 8601 timestamp — only return messages created before this time.',
          },
          offset: {
            type: 'number',
            description:
              'Skip this many messages from the end of the filtered list (for paging backwards). Default 0.',
          },
          limit: {
            type: 'number',
            description:
              'Max number of messages to return (default 20, max 50).',
          },
        },
      },
      handler: async (input) => {
        const limit = Math.min(
          typeof input.limit === 'number' ? input.limit : 20,
          50,
        );
        const offset =
          typeof input.offset === 'number' ? Math.max(0, input.offset) : 0;
        const direction =
          input.direction === 'inbound' || input.direction === 'outbound'
            ? input.direction
            : 'all';
        const search = input.search
          ? String(input.search).toLowerCase()
          : undefined;
        const after = input.after ? String(input.after) : undefined;
        const before = input.before ? String(input.before) : undefined;

        let messages = await engine.store.listMessages();

        if (direction !== 'all') {
          messages = messages.filter((m) => m.direction === direction);
        }
        if (after) {
          messages = messages.filter((m) => m.createdAt > after);
        }
        if (before) {
          messages = messages.filter((m) => m.createdAt < before);
        }
        if (search) {
          messages = messages.filter((m) =>
            m.content.toLowerCase().includes(search),
          );
        }

        // Page from the end: drop `offset` from the tail, then take `limit`.
        const end = messages.length - offset;
        const page =
          end <= 0 ? [] : messages.slice(Math.max(0, end - limit), end);

        if (page.length === 0) return '(no messages)';

        const total = messages.length;
        const header =
          total > limit + offset
            ? `(showing ${page.length} of ${total} matched — use offset to page further back)\n\n`
            : '';

        return (
          header +
          page
            .map(
              (m) =>
                `[${m.direction === 'inbound' ? 'User' : 'Agent'}] ${m.createdAt}\n${m.content}`,
            )
            .join('\n\n---\n\n')
        );
      },
    },
  ];
}

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
        'Kick off a new body of work as its own workstream. This creates the workstream and hands it to an orchestrator call that will plan and execute it asynchronously. For repository fix/implement tasks, always pass repoUrl (and baseCommit when the task specifies one).',
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
            description:
              'Repository URL when the work targets a GitHub repo (required for clone/fix tasks).',
          },
          baseCommit: {
            type: 'string',
            description:
              'Optional git commit to check out after cloning (bench / SWE tasks).',
          },
        },
        required: ['title', 'goal'],
      },
      handler: async (input) => {
        let title = String(input.title);
        let goal = String(input.goal);
        let repoUrl = input.repoUrl ? String(input.repoUrl) : undefined;
        let baseCommit = input.baseCommit
          ? String(input.baseCommit)
          : undefined;

        const header = parseWorkstreamHeader(`${goal}\n\n${run.task}`);
        if (header) {
          if (header.title) title = header.title;
          repoUrl ??= header.repoUrl;
          baseCommit ??= header.baseCommit;
        }

        const ws = await engine.startWorkstream({
          title,
          goal,
          repoUrl,
          baseCommit,
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
          workstreamId: {
            type: 'string',
            description: 'Target workstream id.',
          },
          note: { type: 'string', description: 'The note / instruction.' },
        },
        required: ['workstreamId', 'note'],
      },
      handler: async (input) => {
        if (isRepoTaskMessage(run.task)) {
          return (
            'Error: Repo tasks are fully described in the inbound message. ' +
            'Use start_workstream once, then reply — do not send_note during intake.'
          );
        }
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
        if (engine.config.evalMode) {
          return 'Error: Identity writes are disabled during eval mode.';
        }
        const material = String(input.material);
        if (isRepoTaskMessage(run.task) || looksLikeRepoSource(material)) {
          return 'Error: Use start_workstream for repo tasks; learn is for reference material only.';
        }
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
