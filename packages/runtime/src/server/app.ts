import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  buildCallTree,
  emptySummary,
  groupBy,
  summarize,
  summarizeByRole,
} from '../engine/cost.js';
import type { Engine } from '../engine/engine.js';

const sendMessageSchema = z.object({
  content: z.string().min(1, 'content is required'),
});

/** Builds the Hono app exposing the agent's "person-like" HTTP surface. */
export function createApp(engine: Engine): Hono {
  const app = new Hono();
  app.use('*', cors());

  app.get('/health', (c) => c.json({ ok: true, agent: engine.config.agentName }));

  // --- Messages: talk to the agent ---

  app.post('/messages', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const message = await engine.receiveMessage(parsed.data.content);
    return c.json({ message }, 202);
  });

  app.get('/messages', async (c) => {
    const messages = await engine.store.listMessages();
    return c.json({ messages });
  });

  // --- State ---

  app.get('/state', async (c) => {
    const state = await engine.getState();
    return c.json(state);
  });

  // --- Workstreams ---

  app.get('/workstreams', async (c) => {
    const workstreams = await engine.store.listWorkstreams();
    return c.json({ workstreams });
  });

  app.get('/workstreams/:id', async (c) => {
    const id = c.req.param('id');
    const workstream = await engine.store.getWorkstream(id);
    if (!workstream) return c.json({ error: 'not found' }, 404);
    const [tasks, reviews, plan, runs] = await Promise.all([
      engine.store.listTasks(id),
      engine.store.listReviews(id),
      engine.store.readPlan(id),
      engine.store.listRunsForWorkstream(id),
    ]);
    const usage = {
      total: summarize(runs),
      byTask: groupBy(runs, (r) => r.taskId),
      byRole: summarizeByRole(runs),
    };
    return c.json({ workstream, tasks, reviews, plan, runs, usage });
  });

  // --- Memories ---

  app.get('/memories', async (c) => {
    const q = c.req.query('q');
    if (q) {
      const memories = await engine.store.queryMemories(q, { limit: 20 });
      return c.json({ memories });
    }
    const memories = await engine.store.listMemories();
    memories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({ memories });
  });

  // --- Observability: tokens and cost ---

  // Overall usage with breakdowns by inbound message, workstream, and role.
  app.get('/usage', async (c) => {
    const [runs, messages] = await Promise.all([
      engine.store.listRuns(),
      engine.store.listMessages(),
    ]);
    const byMessageGroups = groupBy(runs, (r) => r.originMessageId);
    const byMessage = messages
      .filter((m) => m.direction === 'inbound')
      .map((m) => ({
        messageId: m.id,
        createdAt: m.createdAt,
        content:
          m.content.length > 140 ? `${m.content.slice(0, 140)}…` : m.content,
        usage: byMessageGroups[m.id] ?? emptySummary(),
      }));
    return c.json({
      total: summarize(runs),
      byRole: summarizeByRole(runs),
      byModel: groupBy(runs, (r) => r.model),
      byWorkstream: groupBy(runs, (r) => r.workstreamId),
      byMessage,
    });
  });

  // Cost of a single inbound message, including the full nested call tree.
  app.get('/messages/:id/cost', async (c) => {
    const id = c.req.param('id');
    const messages = await engine.store.listMessages();
    const message = messages.find((m) => m.id === id);
    if (!message) return c.json({ error: 'not found' }, 404);
    const runs = (await engine.store.listRuns()).filter(
      (r) => r.originMessageId === id,
    );
    return c.json({
      message,
      total: summarize(runs),
      byWorkstream: groupBy(runs, (r) => r.workstreamId),
      byRole: summarizeByRole(runs),
      tree: buildCallTree(runs),
    });
  });

  // --- Live event stream ---

  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      let open = true;
      const unsubscribe = engine.subscribe((event) => {
        void stream.writeSSE({
          event: event.kind,
          data: JSON.stringify(event),
        });
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      // Heartbeat keeps the connection alive until the client disconnects.
      while (open) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(15_000);
      }
    }),
  );

  return app;
}
