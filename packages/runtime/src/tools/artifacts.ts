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
      name: 'submit_review',
      description:
        'Record a review of a plan or a piece of work, including notes and whether it is approved. The orchestrator uses this to decide next steps.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'What was reviewed (e.g. "plan", or a file path).',
          },
          notes: { type: 'string', description: 'Review feedback.' },
          approved: {
            type: 'boolean',
            description: 'Whether the work is approved as-is.',
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
        const review = await store.createReview({
          workstreamId,
          target: String(input.target),
          notes: String(input.notes),
          approved: Boolean(input.approved),
        });
        return `Review ${review.id} recorded (approved: ${review.approved}).`;
      },
    },
  ];
}
