import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

/** Planner/reviewer tools that read and write workstream artifacts. */
export function createArtifactTools(ctx: ToolContext): ToolDef[] {
  const { engine, run } = ctx;
  const { store } = engine;

  return [
    {
      name: 'write_plan',
      description:
        'Save the plan for the current workstream as a markdown artifact. This is the planner\'s primary output.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The full plan, in markdown.',
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
        },
        required: ['content'],
      },
      handler: async (input) => {
        const workstreamId =
          (input.workstreamId as string | undefined) ?? run.workstreamId;
        if (!workstreamId) return 'Error: no workstream to write a plan for.';
        await store.writePlan(workstreamId, String(input.content));
        return `Plan saved for workstream ${workstreamId}.`;
      },
    },
    {
      name: 'read_plan',
      description: 'Read the current plan artifact for a workstream.',
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
        },
      },
      handler: async (input) => {
        const workstreamId =
          (input.workstreamId as string | undefined) ?? run.workstreamId;
        if (!workstreamId) return 'Error: no workstream specified.';
        const plan = await store.readPlan(workstreamId);
        return plan ?? '(no plan yet)';
      },
    },
    {
      name: 'report_status',
      description:
        'Report the outcome of this work run. Call this once, near the end of your turn, ' +
        'before you stop — it is how the orchestrator learns whether you finished, and what ' +
        'to do next. Do not just describe your status in prose; this call is required.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['done', 'done_with_concerns', 'blocked', 'needs_context'],
            description:
              '"done": the task is complete and verified. ' +
              '"done_with_concerns": complete, but you have doubts worth flagging. ' +
              '"blocked": you could not complete it. ' +
              '"needs_context": you are missing information needed to proceed.',
          },
          summary: {
            type: 'string',
            description:
              'What you changed (or attempted) and the verification you ran. For ' +
              'blocked/needs_context, say exactly what you tried and what is missing or blocking.',
          },
          followUps: {
            type: 'string',
            description: 'Optional follow-ups or concerns for the reviewer.',
          },
        },
        required: ['status', 'summary'],
      },
      handler: async (input) => {
        const status = String(input.status);
        const summary = String(input.summary);
        return `Status recorded: ${status}. ${summary}`;
      },
    },
    {
      name: 'submit_review',
      description:
        'Record a review of a plan or a piece of work, including notes and whether it is approved. The orchestrator uses this to decide next steps. Approve only when there are no Critical or Important issues.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'What was reviewed (e.g. "plan", or a file path).',
          },
          notes: {
            type: 'string',
            description: 'Review feedback, grouped by severity.',
          },
          approved: {
            type: 'boolean',
            description: 'Whether the work is approved as-is.',
          },
          stage: {
            type: 'string',
            enum: ['plan', 'work'],
            description: 'Whether you reviewed the plan or the implemented work.',
          },
          severity: {
            type: 'string',
            enum: ['critical', 'important', 'minor', 'none'],
            description:
              'Highest-severity issue you found; "none" when nothing needs to change.',
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
        },
        required: ['target', 'notes', 'approved'],
      },
      handler: async (input) => {
        const workstreamId =
          (input.workstreamId as string | undefined) ?? run.workstreamId;
        if (!workstreamId) return 'Error: no workstream specified.';
        const stage =
          input.stage === 'plan' || input.stage === 'work'
            ? input.stage
            : undefined;
        const severity = (
          ['critical', 'important', 'minor', 'none'] as const
        ).includes(input.severity as never)
          ? (input.severity as 'critical' | 'important' | 'minor' | 'none')
          : undefined;
        const review = await store.createReview({
          workstreamId,
          target: String(input.target),
          notes: String(input.notes),
          approved: Boolean(input.approved),
          stage,
          severity,
        });
        return `Review ${review.id} recorded (approved: ${review.approved}${
          severity ? `, severity: ${severity}` : ''
        }).`;
      },
    },
  ];
}
