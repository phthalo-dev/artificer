import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import path from 'node:path';
import {
  listLearnBatchFiles,
  mergeLearnBatches,
  trashLearnBatches,
  writeLearnBatch,
  type LearnBatchFact,
} from '../storage/learn-batches.js';

/**
 * Librarian tools for large learn jobs: write scratch batches under
 * `{exec}/tmp/learn-{runId}/`, then merge once into add_memory.
 */
export function createLearnBatchTools(ctx: ToolContext): ToolDef[] {
  const { engine, run } = ctx;
  const execRoot = engine.store.layout.root;

  return [
    {
      name: 'save_learn_batch',
      description:
        'For large learn jobs: write a small JSON batch of extracted facts to scratch (not the reply). Call once per batch; keep the tool result short.',
      inputSchema: {
        type: 'object',
        properties: {
          batch: {
            type: 'number',
            description: '1-based batch index.',
          },
          facts: {
            type: 'array',
            description: 'Facts extracted in this batch.',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                title: { type: 'string' },
                summary: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                source: { type: 'string' },
                kind: { type: 'string' },
                related: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string' },
                    },
                    required: ['id'],
                  },
                },
              },
              required: ['content'],
            },
          },
        },
        required: ['batch', 'facts'],
      },
      handler: async (input) => {
        const batch = typeof input.batch === 'number' ? input.batch : 1;
        const facts = Array.isArray(input.facts)
          ? (input.facts as LearnBatchFact[])
          : [];
        const file = await writeLearnBatch(execRoot, run.id, batch, facts);
        return `Wrote batch ${batch} (${facts.length} facts) → ${path.basename(file)}. Do not paste the JSON in your reply.`;
      },
    },
    {
      name: 'finalize_learn_batches',
      description:
        'Merge all save_learn_batch scratch files for this run into durable memories (dedupe entities, normalize kinds), then delete the scratch dir. Returns a short summary.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const files = await listLearnBatchFiles(execRoot, run.id);
        if (files.length === 0) {
          return 'No learn batches found for this run.';
        }
        const merged = await mergeLearnBatches(execRoot, run.id);
        const memStore = engine.identity ?? engine.store;
        const saved: string[] = [];
        for (const item of merged) {
          const memory = await memStore.addMemory(item);
          saved.push(memory.title ?? memory.id);
        }
        await trashLearnBatches(execRoot, run.id);
        return `Merged ${files.length} batch(es) into ${saved.length} memor${saved.length === 1 ? 'y' : 'ies'}: ${saved.join('; ') || '(none)'}. Scratch cleared.`;
      },
    },
  ];
}
