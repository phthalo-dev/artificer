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
import { runGithubWatchOnce as defaultRunGithubWatchOnce } from '../engine/github-watch-runner.js';
import type { GithubWatchState } from '../engine/github-watch.js';
import { type LlmSdkPackage, MODEL_CATALOG } from '../llm/catalog.js';
import { listPresets } from '../engine/presets.js';
import { primaryAccountIdFor } from '../engine/quota-config.js';
import type { QuotaConfig } from '../engine/quota-types.js';
import { readBenchOverview, readBenchRun, readBenchSuites } from './bench.js';
import { bearerAuth, sseAuth } from './auth.js';
import { serveUI } from './static.js';
import { resolveUiDistDir } from './ui-dist.js';
import { mountChannels } from '../channels/mount.js';
import type { ArtificerChannel } from '../api/types.js';
import type { IdentityStore } from '../storage/identity-store.js';

const sendMessageSchema = z.object({
  content: z.string().min(1, 'content is required'),
});

const updateModelsSchema = z
  .object({
    low: z.string().min(1).optional(),
    medium: z.string().min(1).optional(),
    high: z.string().min(1).optional(),
  })
  .refine((v) => v.low || v.medium || v.high, {
    message: 'provide at least one tier',
  });

const updateRoleTiersSchema = z.record(
  z.enum([
    'communicator',
    'orchestrator',
    'planner',
    'reviewer',
    'worker',
    'librarian',
  ]),
  z.enum(['low', 'medium', 'high']),
);

const applyPresetSchema = z.object({
  presetId: z.string().min(1),
});

const createWorkstreamSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  repoUrl: z.string().min(1).optional(),
  baseCommit: z.string().min(1).optional(),
  autostart: z.boolean().optional(),
});

const startWorkstreamSchema = z.object({
  messageId: z.string().min(1),
});

const PROVIDER_LABEL: Record<LlmSdkPackage, string> = {
  '@ai-sdk/anthropic': 'Anthropic',
  '@ai-sdk/openai': 'OpenAI',
  '@ai-sdk/google': 'Google',
  '@ai-sdk/openai-compatible': 'OpenAI-compatible',
};

const createMemorySchema = z.object({
  content: z.string().min(1, 'content is required'),
  title: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  kind: z
    .enum(['note', 'document', 'preference', 'claim', 'entity'])
    .optional(),
  related: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z
          .enum([
            'related',
            'builds_on',
            'contradicts',
            'cites',
            'categorized_under',
          ])
          .default('related'),
      }),
    )
    .optional(),
});

const quotaWindowSchema = z.object({
  id: z.string().min(1),
  unit: z.enum(['dollars', 'tokens', 'requests']),
  period: z.enum(['rolling5h', 'daily', 'weekly', 'monthly', 'fixed']),
  scope: z.enum(['global', 'workstream']).optional(),
  limit: z.number().positive(),
  warnAtPercent: z.number().min(0).max(100).optional(),
  blockAtPercent: z.number().min(0).max(100).optional(),
});

const failoverLlmSchema = z.object({
  baseURL: z.string().min(1),
  apiKeyEnv: z.string().optional(),
  preset: z.string().optional(),
  models: z
    .object({
      low: z.string().optional(),
      medium: z.string().optional(),
      high: z.string().optional(),
    })
    .optional(),
});

const failoverTargetSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  roles: z.array(z.string()).optional(),
  llm: failoverLlmSchema.optional(),
  executor: z
    .union([
      z.literal('llm'),
      z.literal('cursor-agent'),
      z.literal('claude-code'),
    ])
    .optional(),
  onExhausted: z.enum(['wait', 'failover']).optional(),
});

const modelTiersSchema = z.object({
  low: z.string().min(1),
  medium: z.string().min(1),
  high: z.string().min(1),
});

const executionRouteSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  mode: z.enum(['metered', 'windowed', 'opaque']),
  windows: z.array(quotaWindowSchema).min(1),
  execution: z.union([
    z.literal('llm'),
    z.literal('cursor-agent'),
    z.literal('claude-code'),
  ]),
  llm: z
    .object({
      baseURL: z.string().min(1),
      apiKeyEnv: z.string().optional(),
    })
    .optional(),
  presetId: z.string().optional(),
  models: modelTiersSchema,
  roleTiers: updateRoleTiersSchema.optional(),
  roles: z.array(z.string()).optional(),
  pollIntervalMs: z.number().positive().optional(),
});

const quotaAccountSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(['metered', 'windowed', 'opaque']),
  windows: z.array(quotaWindowSchema).min(1),
  onExhausted: z.enum(['wait', 'failover']).optional(),
  failover: z.array(failoverTargetSchema).optional(),
  pollIntervalMs: z.number().positive().optional(),
});

const quotaConfigSchema = z
  .object({
    reservePercent: z.number().min(0).max(50).optional(),
    defaultEstimateDollars: z
      .object({
        low: z.number().optional(),
        medium: z.number().optional(),
        high: z.number().optional(),
      })
      .optional(),
    routes: z.array(executionRouteSchema).min(1).optional(),
    accounts: z.array(quotaAccountSchema).min(1).optional(),
  })
  .refine((v) => (v.routes?.length ?? 0) > 0 || (v.accounts?.length ?? 0) > 0, {
    message: 'provide routes or legacy accounts',
  });

export interface AppDeps {
  /** Runs one GitHub watch cycle and persists the resulting state. Overridable for tests. */
  runGithubWatchOnce?: (
    engine: Engine,
    log?: (message: string) => void,
  ) => Promise<GithubWatchState>;
  /** Directory containing pre-built @artificer-ai/ui assets. When set, the UI SPA is served at /. */
  uiDistDir?: string;
  /** Persistent identity store. Required for /api/memories routes. */
  identity?: IdentityStore;
  /** Channel adapters mounted at /channels/{name} before static UI. */
  channels?: ArtificerChannel[];
}

/** Builds the Hono app exposing the agent's "person-like" HTTP surface. */
export function createApp(engine: Engine, deps: AppDeps = {}): Hono {
  const app = new Hono();
  app.use('*', cors());
  const runGithubWatchOnce =
    deps.runGithubWatchOnce ?? defaultRunGithubWatchOnce;

  // --- Live event stream (at root level, not under /api) ---

  app.get('/events', sseAuth(engine.config.apiAuthKey), (c) =>
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
      while (open) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(15_000);
      }
    }),
  );

  // --- API routes (all under /api) ---

  const api = new Hono();
  api.use('*', bearerAuth(engine.config.apiAuthKey));

  api.get('/health', (c) =>
    c.json({ ok: true, agent: engine.config.agentName }),
  );

  api.get('/config/models', (c) => {
    const catalog = Object.values(MODEL_CATALOG).map((entry) => ({
      id: entry.id,
      provider: PROVIDER_LABEL[entry.npm],
      pricing: entry.pricing,
    }));
    return c.json({
      tiers: engine.getModelTiers(),
      roleTiers: engine.config.roleTiers,
      activePresetId: engine.getModelPresetId(),
      presets: listPresets().map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        tiers: p.tiers,
        roleTiers: p.roleTiers,
      })),
      catalog,
    });
  });

  api.put('/config/models', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateModelsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const tiers = engine.setModelTiers(parsed.data);
    void engine.persistConfig();
    return c.json({
      tiers,
      roleTiers: engine.config.roleTiers,
      activePresetId: engine.getModelPresetId(),
    });
  });

  api.put('/config/role-tiers', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateRoleTiersSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const roleTiers = engine.setRoleTiers(parsed.data);
    void engine.persistConfig();
    return c.json({
      tiers: engine.getModelTiers(),
      roleTiers,
      activePresetId: engine.getModelPresetId(),
    });
  });

  api.put('/config/preset', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = applyPresetSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const applied = engine.applyPreset(parsed.data.presetId);
      void engine.persistConfig();
      return c.json({
        presetId: applied.preset.id,
        name: applied.preset.name,
        tiers: applied.tiers,
        roleTiers: applied.roleTiers,
        activePresetId: engine.getModelPresetId(),
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        400,
      );
    }
  });

  api.get('/config/quota', (c) => {
    const configured = engine.getConfiguredQuota() ?? null;
    const effective = engine.getEffectiveQuotaConfig() ?? null;
    const catalog = Object.values(MODEL_CATALOG).map((entry) => ({
      id: entry.id,
      provider: PROVIDER_LABEL[entry.npm],
      pricing: entry.pricing,
    }));
    return c.json({
      configured,
      effective,
      primaryAccountId: primaryAccountIdFor(engine.config),
      catalog,
      presets: listPresets().map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        tiers: p.tiers,
        roleTiers: p.roleTiers,
      })),
    });
  });

  api.put('/config/quota', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = quotaConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      engine.setQuotaConfig(parsed.data as QuotaConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
    void engine.persistProviderConfig();
    return c.json({
      configured: engine.getConfiguredQuota() ?? null,
      effective: engine.getEffectiveQuotaConfig() ?? null,
      primaryAccountId: primaryAccountIdFor(engine.config),
      quota: engine.getQuotaSnapshot() ?? null,
    });
  });

  api.post('/messages', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const message = await engine.receiveMessage(parsed.data.content);
    return c.json({ message }, 202);
  });

  api.get('/messages', async (c) => {
    const messages = await engine.store.listMessages();
    return c.json({ messages });
  });

  api.get('/state', async (c) => {
    const state = await engine.getState();
    return c.json(state);
  });

  api.post('/workstreams', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createWorkstreamSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { workstream, messageId } = await engine.createDirectWorkstream(
      parsed.data,
    );
    return c.json({ workstreamId: workstream.id, messageId }, 202);
  });

  api.post('/workstreams/:id/start', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = startWorkstreamSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      await engine.kickoffWorkstream(id, parsed.data.messageId);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        404,
      );
    }
    return c.json({ ok: true }, 202);
  });

  api.post('/workstreams/:id/cancel', async (c) => {
    const id = c.req.param('id');
    const ok = await engine.cancelWorkstream(id);
    if (!ok) return c.json({ error: 'not found or already terminal' }, 404);
    return c.json({ ok: true });
  });

  api.get('/workstreams', async (c) => {
    const workstreams = await engine.store.listWorkstreams();
    return c.json({ workstreams });
  });

  api.get('/workstreams/:id', async (c) => {
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
    return c.json({
      workstream,
      tasks,
      reviews,
      plan,
      runs,
      usage,
      tree: buildCallTree(runs),
    });
  });

  api.get('/memories', async (c) => {
    if (!deps.identity)
      return c.json({ error: 'identity store not configured' }, 503);
    const q = c.req.query('q')?.trim();
    if (q) {
      const memories = await deps.identity.queryMemories(q, { limit: 20 });
      return c.json({ memories });
    }
    const memories = await deps.identity.listMemories();
    memories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({ memories });
  });

  api.post('/memories', async (c) => {
    if (!deps.identity)
      return c.json({ error: 'identity store not configured' }, 503);
    const body = await c.req.json().catch(() => ({}));
    const parsed = createMemorySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const memory = await deps.identity.addMemory({
      content: parsed.data.content,
      title: parsed.data.title,
      summary: parsed.data.summary,
      tags: parsed.data.tags ?? [],
      source: parsed.data.source,
      kind: parsed.data.kind,
      related: parsed.data.related,
    });
    return c.json({ memory }, 201);
  });

  api.delete('/memories/:id', async (c) => {
    if (!deps.identity)
      return c.json({ error: 'identity store not configured' }, 503);
    const id = c.req.param('id');
    const deleted = await deps.identity.deleteMemory(id);
    if (!deleted) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  api.get('/usage', async (c) => {
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
      byRoute: groupBy(runs, (r) => r.routeProfileId),
      byWorkstream: groupBy(runs, (r) => r.workstreamId),
      byMessage,
      quota: engine.getQuotaSnapshot() ?? null,
    });
  });

  api.post('/quota/reset', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const accountId =
      typeof body.accountId === 'string' ? body.accountId : undefined;
    const windowId =
      typeof body.windowId === 'string' ? body.windowId : undefined;
    const workstreamId =
      typeof body.workstreamId === 'string' ? body.workstreamId : undefined;
    if (!accountId || !windowId) {
      return c.json({ error: 'accountId and windowId are required' }, 400);
    }
    const ok = engine.resetQuotaWindow(accountId, windowId, workstreamId);
    if (!ok) return c.json({ error: 'window not found' }, 404);
    return c.json({ ok: true, quota: engine.getQuotaSnapshot() ?? null });
  });

  api.get('/messages/:id/cost', async (c) => {
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

  api.get('/bench/runs', async (c) => {
    const overview = await readBenchOverview();
    if (!overview) {
      return c.json({ error: 'no benchmark results (run `pnpm bench`)' }, 404);
    }
    return c.json(overview);
  });

  api.get('/bench/suites', async (c) => {
    const suites = await readBenchSuites();
    return c.json({ suites });
  });

  api.get('/bench/runs/:instanceId', async (c) => {
    const detail = await readBenchRun(c.req.param('instanceId'));
    if (!detail) return c.json({ error: 'not found' }, 404);
    return c.json(detail);
  });

  api.post('/github/watch', async (c) => {
    if (!engine.config.github) {
      return c.json(
        { error: 'GitHub is not configured (set GITHUB_TOKEN)' },
        400,
      );
    }
    const state = await runGithubWatchOnce(engine, (msg) =>
      // eslint-disable-next-line no-console
      console.log(`[github-watch] ${msg}`),
    );
    return c.json({ state });
  });

  app.route('/api', api);

  if (deps.channels?.length) {
    mountChannels(app, deps.channels, engine);
  }

  // --- Static UI serving ---

  const uiDistDir = deps.uiDistDir ?? resolveUiDistDir();
  app.use('*', serveUI(uiDistDir));

  app.all('*', (c) =>
    c.json(
      {
        error: 'Not found',
        hint: 'UI assets not built. Run: pnpm --filter @artificer-ai/runtime build:ui',
      },
      404,
    ),
  );

  return app;
}
