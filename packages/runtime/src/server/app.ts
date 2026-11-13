import { randomUUID } from 'node:crypto';
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
import {
  ConversationBusy,
  ConversationWorkstreamInputError,
  type Engine,
  WorktreeRemovalConflict,
} from '../engine/engine.js';
import { runGithubWatchOnce as defaultRunGithubWatchOnce } from '../engine/github-watch-runner.js';
import type { GithubWatchState } from '../engine/github-watch.js';
import { loadRepos } from '../engine/repos.js';
import { ACP_PRESETS, resolveAcpLaunch } from '../engine/acp-presets.js';
import { type LlmSdkPackage, MODEL_CATALOG } from '../llm/catalog.js';
import { listPresets } from '../engine/presets.js';
import { primaryAccountIdFor } from '../engine/quota-config.js';
import type { QuotaConfig } from '../engine/quota-types.js';
import { computeRetryCounters } from '../engine/workstream-retry-counters.js';
import {
  MAX_REVIEW_CYCLES,
  MAX_WORKER_RUNS_BEFORE_REVIEW,
  MAX_FAILED_RUNS,
  MAX_PLANNER_ATTEMPTS,
} from '../engine/workstream-machine.js';
import { MAX_NO_PROGRESS_REPEATS } from '../engine/worker-progress.js';
import { readBenchOverview, readBenchRun, readBenchSuites } from './bench.js';
import { bearerAuth, sseAuth } from './auth.js';
import { serveUI } from './static.js';
import { resolveUiDistDir } from './ui-dist.js';
import { mountChannels } from '../channels/mount.js';
import type { ArtificerChannel, ExecutorConfig } from '../api/types.js';
import { redactExecutorConfig, redactWorkstream } from './redact.js';
import type { IdentityStore } from '../storage/identity-store.js';
import {
  loadEffectivePolicy,
  saveExecPolicy,
  type PolicyRule,
} from '../tools/tool-policy.js';

const sendMessageSchema = z.object({
  content: z.string().min(1, 'content is required'),
});

const removeWorktreeSchema = z.object({
  force: z.boolean().optional(),
});

const createPolicyRuleSchema = z.object({
  tool: z.string().min(1),
  pattern: z.string().min(1),
  effect: z.enum(['allow', 'deny']),
  note: z.string().optional(),
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
    'receipt',
  ]),
  z.enum(['low', 'medium', 'high']),
);

const applyPresetSchema = z.object({
  presetId: z.string().min(1),
});

const executorSchema = z.union([
  z.literal('llm'),
  z.literal('cursor-agent'),
  z.literal('claude-code'),
  z.literal('opencode'),
  z.object({ type: z.literal('cursor-agent'), model: z.string().optional() }),
  z.object({ type: z.literal('claude-code'), model: z.string().optional() }),
  z.object({ type: z.literal('opencode'), model: z.string().optional() }),
  z.object({
    type: z.literal('cli'),
    command: z.string(),
    args: z.array(z.string()),
    promptMode: z.enum(['stdin', 'arg']),
    model: z.string().optional(),
    timeout: z.number().optional(),
    mcpConfigPath: z.string().optional(),
  }),
  z
    .object({
      type: z.literal('acp'),
      agent: z.enum(['opencode', 'codex']).optional(),
      command: z.string().min(1).optional(),
      args: z.array(z.string()).optional(),
      model: z.string().min(1).optional(),
      env: z.record(z.string()).optional(),
      mode: z.string().min(1).optional(),
      resumes: z.boolean().optional(),
      timeout: z.number().int().positive().optional(),
    })
    .strict()
    .refine(
      (v) =>
        (v.agent !== undefined) !== (v.command !== undefined) &&
        (v.command === undefined || v.args !== undefined),
      {
        message:
          'acp executor needs exactly one of agent or command (command requires args)',
      },
    )
    .refine((v) => v.agent === undefined || v.args === undefined, {
      message: 'acp executor: args cannot be overridden for a preset',
    })
    .superRefine((v, ctx) => {
      try {
        resolveAcpLaunch(v);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
]);

const machineWorkstreamSchema = z.object({
  driver: z.literal('machine').optional(),
  title: z.string().min(1),
  goal: z.string().min(1),
  repoUrl: z.string().min(1).optional(),
  baseCommit: z.string().min(1).optional(),
  autostart: z.boolean().optional(),
  submitPr: z.boolean().optional(),
});

const conversationWorkstreamSchema = z
  .object({
    driver: z.literal('conversation'),
    title: z.string().min(1),
    goal: z.string().min(1),
    repoId: z.string().min(1),
    executor: executorSchema.optional(),
    message: z.string().optional(),
    baseCommit: z.string().min(1).optional(),
  })
  .strict();

const createWorkstreamSchema = z.union([
  machineWorkstreamSchema,
  conversationWorkstreamSchema,
]);

const startWorkstreamSchema = z.object({
  messageId: z.string().min(1),
});

const artifactKeySchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'invalid artifact key');

const createArtifactSchema = z.object({
  key: artifactKeySchema,
  name: z.string().min(1),
  description: z.string().optional(),
  contentType: z.string().min(1),
  visibility: z.enum(['private', 'link', 'public']).optional(),
});

const patchArtifactSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    contentType: z.string().min(1).optional(),
    visibility: z.enum(['private', 'link', 'public']).optional(),
  })
  .refine((v) => v.name || v.description || v.contentType || v.visibility, {
    message: 'provide at least one field to update',
  });

const createArtifactVersionSchema = z.object({
  content: z.string(),
  contentType: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  sourcePath: z.string().optional(),
});

function artifactError(
  c: { json: (body: unknown, status?: number) => Response },
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    message.includes('not found') || message.includes('Workstream not found')
      ? 404
      : message.includes('already exists') ||
          message.includes('Invalid') ||
          message.includes('Cannot') ||
          message.includes('must be')
        ? 400
        : 409;
  return c.json({ error: message }, status);
}

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
      z.literal('opencode'),
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
    z.literal('opencode'),
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

  api.get('/policy/rules', (c) => {
    const policy = loadEffectivePolicy({
      execPath: engine.store.layout.toolPolicyFile(),
      identityPath: engine.identity?.layout.agentToolPolicyFile(),
    });
    return c.json({ rules: policy.rules });
  });

  api.post('/policy/rules', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createPolicyRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const execPath = engine.store.layout.toolPolicyFile();
    const policy = loadEffectivePolicy({ execPath });
    const rule: PolicyRule = {
      id: randomUUID(),
      ...parsed.data,
      scope: 'agent',
      createdAt: new Date().toISOString(),
    };
    saveExecPolicy(execPath, {
      version: 1,
      rules: [...policy.rules, rule],
    });
    return c.json({ rule }, 201);
  });

  api.delete('/policy/rules/:id', (c) => {
    const execPath = engine.store.layout.toolPolicyFile();
    const policy = loadEffectivePolicy({ execPath });
    const id = c.req.param('id');
    if (!policy.rules.some((rule) => rule.id === id)) {
      return c.json({ error: 'not found' }, 404);
    }

    saveExecPolicy(execPath, {
      version: 1,
      rules: policy.rules.filter((rule) => rule.id !== id),
    });
    return c.json({ ok: true });
  });

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
    const messages = await engine.listInboxMessages();
    return c.json({ messages });
  });

  api.get('/state', async (c) => {
    const state = await engine.getState();
    return c.json(state);
  });

  api.get('/repos', (c) => {
    const loaded = loadRepos(engine.config.repos);
    if (!loaded.ok) return c.json({ error: loaded.error }, 400);
    return c.json({ repos: loaded.repos });
  });

  api.get('/executors', (c) => {
    const executors: Array<{
      id: string;
      label: string;
      executor: ExecutorConfig | null;
      permissionEnforcement?: 'acp-requests' | 'none';
    }> = [
      { id: 'instance', label: 'Instance default', executor: null },
      { id: 'llm', label: 'Built-in loop', executor: 'llm' },
      { id: 'claude-code', label: 'Claude Code', executor: 'claude-code' },
      { id: 'cursor-agent', label: 'Cursor', executor: 'cursor-agent' },
    ];
    for (const preset of Object.values(ACP_PRESETS)) {
      if (!preset.certified) continue;
      executors.push({
        id: `acp:${preset.id}`,
        label: `${preset.label} (ACP)`,
        executor: { type: 'acp', agent: preset.id },
        permissionEnforcement: preset.permissionEnforcement,
      });
    }
    return c.json({ executors });
  });

  api.post('/workstreams', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createWorkstreamSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    if (parsed.data.driver === 'conversation') {
      try {
        const result = await engine.createConversationWorkstream(parsed.data);
        return c.json(
          { ...result, workstream: redactWorkstream(result.workstream) },
          201,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status =
          error instanceof ConversationWorkstreamInputError ? 400 : 500;
        return c.json({ error: message }, status);
      }
    }
    const { workstream, messageId } = await engine.createDirectWorkstream(
      parsed.data,
    );
    return c.json({ workstreamId: workstream.id, messageId }, 202);
  });

  api.post('/workstreams/:id/messages', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const message = await engine.postConversationMessage(
        c.req.param('id'),
        parsed.data.content,
      );
      return c.json({ message }, 202);
    } catch (error) {
      if (error instanceof ConversationBusy) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  api.get('/workstreams/:id/messages', async (c) => {
    const id = c.req.param('id');
    const messages = (await engine.store.listMessages())
      .filter((message) => message.workstreamId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return c.json({ messages });
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

  api.post('/workstreams/:id/done', async (c) => {
    const ok = await engine.markConversationDone(c.req.param('id'));
    if (!ok) {
      return c.json({ error: 'conversation cannot be marked done' }, 409);
    }
    return c.json({ ok: true });
  });

  api.post('/workstreams/:id/worktree/remove', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = removeWorktreeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      await engine.removeWorktree(c.req.param('id'), parsed.data.force);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorktreeRemovalConflict) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  api.get('/workstreams', async (c) => {
    const workstreams = await engine.store.listWorkstreams();
    return c.json({ workstreams: workstreams.map(redactWorkstream) });
  });

  api.get('/traces', async (c) => {
    const rawLimit = c.req.query('limit');
    const parsedLimit = rawLimit === undefined ? 100 : Number(rawLimit);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 200
    ) {
      return c.json(
        { error: 'limit must be an integer between 1 and 200' },
        400,
      );
    }
    const traces = await engine.traceRecorder.list({ limit: parsedLimit });
    return c.json({ traces });
  });

  api.get('/traces/:id', async (c) => {
    try {
      const trace = await engine.traceRecorder.get(c.req.param('id'));
      if (!trace) return c.json({ error: 'not found' }, 404);
      return c.json({ trace });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  api.get('/traces/:id/events', async (c) => {
    const rawOffset = c.req.query('offset');
    const rawLimit = c.req.query('limit');
    const offset = rawOffset === undefined ? 0 : Number(rawOffset);
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200
    ) {
      return c.json(
        {
          error:
            'offset must be >= 0 and limit must be an integer between 1 and 200',
        },
        400,
      );
    }
    try {
      const trace = await engine.traceRecorder.get(c.req.param('id'));
      if (!trace) return c.json({ error: 'not found' }, 404);
      const events = await engine.traceRecorder.listEvents(trace.id, {
        offset,
        limit,
      });
      return c.json({
        trace,
        events,
        offset,
        limit,
        hasMore: trace.lastSequence > offset + events.length,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  api.get('/workstreams/:id/trace', async (c) => {
    const workstream = await engine.store.getWorkstream(c.req.param('id'));
    if (!workstream) return c.json({ error: 'not found' }, 404);
    const traceId = workstream.traceId ?? `trace_${workstream.id}`;
    let trace = await engine.traceRecorder.get(traceId);
    if (!trace) {
      await engine.traceRecorder.backfill([workstream]);
      trace = await engine.traceRecorder.get(traceId);
    }
    if (!trace) return c.json({ error: 'trace not found' }, 404);
    const events = await engine.traceRecorder.listEvents(trace.id, {
      offset: 0,
      limit: 200,
    });
    return c.json({
      trace,
      events,
      hasMore: trace.lastSequence > events.length,
    });
  });

  api.get('/workstreams/:id/receipt', async (c) => {
    const id = c.req.param('id');
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json' && format !== 'markdown') {
      return c.json({ error: 'format must be json or markdown' }, 400);
    }
    const result = await engine.receipts.ensureCurrent(id);
    if (!result) return c.json({ error: 'not found' }, 404);
    if (format === 'markdown') {
      c.header('content-type', 'text/markdown; charset=utf-8');
      return c.body(result.markdown);
    }
    return c.json({ receipt: result.receipt, markdown: result.markdown });
  });

  api.get('/workstreams/:id/artifacts', async (c) => {
    const workstreamId = c.req.param('id');
    const workstream = await engine.store.getWorkstream(workstreamId);
    if (!workstream) return c.json({ error: 'not found' }, 404);
    try {
      const artifacts = await engine.artifacts.list(workstreamId);
      return c.json({ artifacts });
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.post('/workstreams/:id/artifacts', async (c) => {
    const workstreamId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = createArtifactSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const artifact = await engine.artifacts.create(workstreamId, parsed.data);
      return c.json({ artifact }, 201);
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.get('/workstreams/:id/artifacts/:key', async (c) => {
    const workstreamId = c.req.param('id');
    const key = c.req.param('key');
    try {
      const artifact = await engine.artifacts.get(workstreamId, key);
      if (!artifact) return c.json({ error: 'not found' }, 404);
      return c.json({ artifact });
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.patch('/workstreams/:id/artifacts/:key', async (c) => {
    const workstreamId = c.req.param('id');
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const parsed = patchArtifactSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const artifact = await engine.artifacts.patch(
        workstreamId,
        key,
        parsed.data,
      );
      return c.json({ artifact });
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.post('/workstreams/:id/artifacts/:key/archive', async (c) => {
    const workstreamId = c.req.param('id');
    const key = c.req.param('key');
    try {
      const artifact = await engine.artifacts.archive(workstreamId, key);
      return c.json({ artifact });
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.post('/workstreams/:id/artifacts/:key/restore', async (c) => {
    const workstreamId = c.req.param('id');
    const key = c.req.param('key');
    try {
      const artifact = await engine.artifacts.restore(workstreamId, key);
      return c.json({ artifact });
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.get('/workstreams/:id/artifacts/:key/versions', async (c) => {
    const workstreamId = c.req.param('id');
    const key = c.req.param('key');
    try {
      const artifact = await engine.artifacts.get(workstreamId, key);
      if (!artifact) return c.json({ error: 'not found' }, 404);
      return c.json({ versions: artifact.versions });
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.post('/workstreams/:id/artifacts/:key/versions', async (c) => {
    const workstreamId = c.req.param('id');
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const parsed = createArtifactVersionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const result = await engine.artifacts.createVersion(workstreamId, key, {
        content: parsed.data.content,
        contentType: parsed.data.contentType,
        idempotencyKey: parsed.data.idempotencyKey,
        metadata: parsed.data.metadata,
        sourcePath: parsed.data.sourcePath,
      });
      return c.json(result, 201);
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.get('/workstreams/:id/artifacts/:key/versions/:version', async (c) => {
    const workstreamId = c.req.param('id');
    const key = c.req.param('key');
    const version = c.req.param('version');
    try {
      const versionRecord = await engine.artifacts.getVersion(
        workstreamId,
        key,
        version,
      );
      if (!versionRecord) return c.json({ error: 'not found' }, 404);
      return c.json({ version: versionRecord });
    } catch (error) {
      return artifactError(c, error);
    }
  });

  api.get(
    '/workstreams/:id/artifacts/:key/versions/:version/content',
    async (c) => {
      const workstreamId = c.req.param('id');
      const key = c.req.param('key');
      const version = c.req.param('version');
      const rawLimit = c.req.query('limit');
      const limit =
        rawLimit === undefined ? undefined : Number.parseInt(rawLimit, 10);
      if (
        limit !== undefined &&
        (!Number.isInteger(limit) || limit < 1 || limit > 1_048_576)
      ) {
        return c.json(
          { error: 'limit must be an integer between 1 and 1048576' },
          400,
        );
      }
      try {
        const { content, contentType, truncated } =
          await engine.artifacts.readVersionContent(
            workstreamId,
            key,
            version,
            limit,
          );
        c.header('content-type', contentType);
        if (truncated) {
          c.header('x-artificer-truncated', 'true');
        }
        return c.body(new Uint8Array(content));
      } catch (error) {
        return artifactError(c, error);
      }
    },
  );

  api.post(
    '/workstreams/:id/artifacts/:key/versions/:version/request-approval',
    async (c) => {
      const workstreamId = c.req.param('id');
      const key = c.req.param('key');
      const version = c.req.param('version');
      try {
        const artifact = await engine.artifacts.requestApproval(
          workstreamId,
          key,
          version,
        );
        return c.json({ artifact });
      } catch (error) {
        return artifactError(c, error);
      }
    },
  );

  api.post(
    '/workstreams/:id/artifacts/:key/versions/:version/approve',
    async (c) => {
      const workstreamId = c.req.param('id');
      const key = c.req.param('key');
      const version = c.req.param('version');
      try {
        const artifact = await engine.artifacts.approveVersion(
          workstreamId,
          key,
          version,
        );
        return c.json({ artifact });
      } catch (error) {
        return artifactError(c, error);
      }
    },
  );

  api.post(
    '/workstreams/:id/artifacts/:key/versions/:version/reject',
    async (c) => {
      const workstreamId = c.req.param('id');
      const key = c.req.param('key');
      const version = c.req.param('version');
      try {
        const artifact = await engine.artifacts.rejectVersion(
          workstreamId,
          key,
          version,
        );
        return c.json({ artifact });
      } catch (error) {
        return artifactError(c, error);
      }
    },
  );

  api.post(
    '/workstreams/:id/artifacts/:key/versions/:version/release',
    async (c) => {
      const workstreamId = c.req.param('id');
      const key = c.req.param('key');
      const version = c.req.param('version');
      try {
        const artifact = await engine.artifacts.releaseVersion(
          workstreamId,
          key,
          version,
        );
        return c.json({ artifact });
      } catch (error) {
        return artifactError(c, error);
      }
    },
  );

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
    const retry = computeRetryCounters(Boolean(plan), reviews, runs);
    const progress = {
      reviewCycles: { count: retry.reviewCount, max: MAX_REVIEW_CYCLES },
      workerRunsSinceReview: {
        count: retry.workSinceLastReview,
        max: MAX_WORKER_RUNS_BEFORE_REVIEW,
      },
      noProgressRepeats: {
        count: retry.noProgressRepeats,
        max: MAX_NO_PROGRESS_REPEATS,
      },
      consecutiveFailedRuns: {
        count: retry.consecutiveFailedRuns,
        max: MAX_FAILED_RUNS,
      },
      plannerAttempts: {
        count: retry.plannerRunsWithoutPlan,
        max: MAX_PLANNER_ATTEMPTS,
      },
      totalRuns: {
        count: retry.totalRuns,
        max: engine.config.maxRunsPerWorkstream,
      },
    };
    return c.json({
      workstream: redactWorkstream(workstream),
      resolvedExecutor: redactExecutorConfig(
        workstream.executor ?? engine.config.executor ?? null,
      ),
      tasks,
      reviews,
      plan,
      runs,
      usage,
      progress,
      tree: buildCallTree(runs),
    });
  });

  api.get('/memories', async (c) => {
    if (!deps.identity)
      return c.json({ error: 'identity store not configured' }, 503);
    const q = c.req.query('q')?.trim();
    if (q) {
      const limitRaw = c.req.query('limit');
      const budgetRaw = c.req.query('charBudget');
      const limit = limitRaw ? Number(limitRaw) : 20;
      const charBudget = budgetRaw ? Number(budgetRaw) : undefined;
      const packed = await deps.identity.queryMemoriesPacked(q, {
        limit: Number.isFinite(limit) ? limit : 20,
        charBudget:
          charBudget !== undefined && Number.isFinite(charBudget)
            ? charBudget
            : undefined,
      });
      return c.json({
        memories: packed.matched,
        related: packed.related,
        charBudget: packed.charBudget,
        freshnessNotes: packed.freshnessNotes,
      });
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
