import type {
  BenchOverview,
  BenchRunDetail,
  BenchSuiteCatalogEntry,
  Memory,
  Message,
  ModelConfig,
  RunNode,
  RunRecord,
  Task,
  TokenUsage,
  UsageSummary,
  QuotaSnapshot,
  QuotaConfig,
  TraceEvent,
  Workstream,
  WorkstreamArtifact,
  WorkstreamDetail,
  WorkstreamReceiptResponse,
  WorkstreamTraceResponse,
} from '../api/types';

export const MOCK_WORKSTREAM_IDS = {
  active: 'ws-auth-refactor',
  done: 'ws-docs-cleanup',
  planning: 'ws-api-design',
} as const;

export const MOCK_MESSAGE_IDS = {
  hello: 'msg-001',
  refactor: 'msg-002',
  docs: 'msg-003',
} as const;

export const MOCK_BENCH_INSTANCE = 'django__django-12345';

const T0 = '2026-06-26T10:00:00.000Z';
const T1 = '2026-06-26T10:05:00.000Z';
const T2 = '2026-06-26T10:12:00.000Z';
const T3 = '2026-06-26T10:28:00.000Z';
const T4 = '2026-06-26T10:45:00.000Z';

function tokenUsage(
  partial: Partial<TokenUsage & { costUsd: number }> &
    Pick<TokenUsage, 'inputTokens' | 'outputTokens'>,
): TokenUsage & { costUsd: number } {
  return {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    requests: 1,
    costUsd: 0,
    ...partial,
  };
}

function usage(
  partial: Partial<UsageSummary> &
    Pick<UsageSummary, 'inputTokens' | 'outputTokens'>,
): UsageSummary {
  return {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    requests: partial.runs ?? 1,
    runs: partial.runs ?? 1,
    costUsd: partial.costUsd ?? 0,
    ...partial,
  };
}

function run(
  partial: Partial<RunRecord> &
    Pick<RunRecord, 'id' | 'role' | 'task' | 'status' | 'createdAt'>,
): RunRecord {
  return {
    toolCalls: [],
    usage: tokenUsage({ inputTokens: 1200, outputTokens: 400, costUsd: 0.012 }),
    ...partial,
  };
}

function runUsageSummary(r: RunRecord): UsageSummary {
  const u = r.usage as TokenUsage & { costUsd?: number };
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheCreationInputTokens: u.cacheCreationInputTokens,
    cacheReadInputTokens: u.cacheReadInputTokens,
    requests: u.requests,
    runs: 1,
    costUsd: u.costUsd ?? 0,
  };
}

const wsAuthRuns: RunRecord[] = [
  run({
    id: 'run-orch-1',
    role: 'orchestrator',
    task: 'Coordinate auth refactor',
    workstreamId: MOCK_WORKSTREAM_IDS.active,
    model: 'claude-sonnet-4-20250514',
    status: 'done',
    output: 'Delegated planning and implementation to sub-agents.',
    createdAt: T1,
    startedAt: T1,
    finishedAt: T2,
    toolCalls: [
      {
        name: 'delegate',
        input: { role: 'planner', task: 'Draft migration plan' },
        output: 'task created',
        at: T1,
      },
    ],
    usage: tokenUsage({ inputTokens: 2400, outputTokens: 680, costUsd: 0.028 }),
  }),
  run({
    id: 'run-plan-1',
    role: 'planner',
    task: 'Draft migration plan',
    workstreamId: MOCK_WORKSTREAM_IDS.active,
    taskId: 'task-plan-1',
    parentRunId: 'run-orch-1',
    model: 'claude-sonnet-4-20250514',
    status: 'done',
    output:
      'Plan: migrate sessions to JWT, add refresh rotation, update middleware.',
    createdAt: T1,
    startedAt: T1,
    finishedAt: T2,
    toolCalls: [
      {
        name: 'read_file',
        input: { path: 'src/auth/session.ts' },
        output: 'export class SessionStore { ... }',
        at: T1,
      },
    ],
    usage: tokenUsage({
      inputTokens: 8200,
      outputTokens: 2100,
      costUsd: 0.056,
    }),
  }),
  run({
    id: 'run-worker-1',
    role: 'worker',
    task: 'Implement JWT middleware',
    workstreamId: MOCK_WORKSTREAM_IDS.active,
    taskId: 'task-worker-1',
    parentRunId: 'run-plan-1',
    model: 'claude-sonnet-4-20250514',
    status: 'running',
    createdAt: T2,
    startedAt: T2,
    toolCalls: [
      {
        name: 'edit_file',
        input: { path: 'src/auth/jwt.ts', command: 'create middleware' },
        output: 'wrote 84 lines',
        at: T2,
      },
      {
        name: 'run_tests',
        input: { command: 'pnpm test auth' },
        output: '3 passed, 1 failed',
        at: T3,
      },
    ],
    usage: tokenUsage({
      inputTokens: 18400,
      outputTokens: 4200,
      costUsd: 0.112,
    }),
  }),
  run({
    id: 'run-review-1',
    role: 'reviewer',
    task: 'Review plan',
    workstreamId: MOCK_WORKSTREAM_IDS.active,
    taskId: 'task-review-1',
    parentRunId: 'run-orch-1',
    model: 'claude-haiku-4-20250514',
    status: 'done',
    output: 'Plan approved with minor note on token rotation interval.',
    createdAt: T2,
    startedAt: T2,
    finishedAt: T3,
    usage: tokenUsage({ inputTokens: 3100, outputTokens: 420, costUsd: 0.008 }),
  }),
];

function buildTree(runs: RunRecord[]): RunNode[] {
  const byId = new Map<string, RunNode>();
  for (const r of runs) {
    byId.set(r.id, {
      run: r,
      self: runUsageSummary(r),
      cumulative: runUsageSummary(r),
      children: [],
    });
  }
  const roots: RunNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.run.parentRunId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rollUp = (node: RunNode): UsageSummary => {
    let cumulative = { ...node.self };
    for (const child of node.children) {
      const childCum = rollUp(child);
      cumulative = {
        inputTokens: cumulative.inputTokens + childCum.inputTokens,
        outputTokens: cumulative.outputTokens + childCum.outputTokens,
        cacheCreationInputTokens:
          cumulative.cacheCreationInputTokens +
          childCum.cacheCreationInputTokens,
        cacheReadInputTokens:
          cumulative.cacheReadInputTokens + childCum.cacheReadInputTokens,
        requests: cumulative.requests + childCum.requests,
        runs: cumulative.runs + childCum.runs,
        costUsd: cumulative.costUsd + childCum.costUsd,
      };
    }
    node.cumulative = cumulative;
    return cumulative;
  };
  for (const root of roots) rollUp(root);
  return roots;
}

function summarizeRuns(runs: RunRecord[]): UsageSummary {
  return runs.reduce(
    (acc, r) => {
      const u = runUsageSummary(r);
      return {
        inputTokens: acc.inputTokens + u.inputTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        cacheCreationInputTokens:
          acc.cacheCreationInputTokens + u.cacheCreationInputTokens,
        cacheReadInputTokens: acc.cacheReadInputTokens + u.cacheReadInputTokens,
        requests: acc.requests + u.requests,
        runs: acc.runs + 1,
        costUsd: acc.costUsd + u.costUsd,
      };
    },
    usage({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      runs: 0,
      requests: 0,
    }),
  );
}

function byRole(runs: RunRecord[]): Record<string, UsageSummary> {
  const out: Record<string, UsageSummary> = {};
  for (const r of runs) {
    const u = runUsageSummary(r);
    const prev =
      out[r.role] ??
      usage({
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        runs: 0,
        requests: 0,
      });
    out[r.role] = {
      inputTokens: prev.inputTokens + u.inputTokens,
      outputTokens: prev.outputTokens + u.outputTokens,
      cacheCreationInputTokens:
        prev.cacheCreationInputTokens + u.cacheCreationInputTokens,
      cacheReadInputTokens: prev.cacheReadInputTokens + u.cacheReadInputTokens,
      requests: prev.requests + u.requests,
      runs: prev.runs + 1,
      costUsd: prev.costUsd + u.costUsd,
    };
  }
  return out;
}

function byTask(runs: RunRecord[]): Record<string, UsageSummary> {
  const out: Record<string, UsageSummary> = {};
  for (const r of runs) {
    if (!r.taskId) continue;
    const u = runUsageSummary(r);
    const prev =
      out[r.taskId] ??
      usage({
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        runs: 0,
        requests: 0,
      });
    out[r.taskId] = {
      inputTokens: prev.inputTokens + u.inputTokens,
      outputTokens: prev.outputTokens + u.outputTokens,
      cacheCreationInputTokens:
        prev.cacheCreationInputTokens + u.cacheCreationInputTokens,
      cacheReadInputTokens: prev.cacheReadInputTokens + u.cacheReadInputTokens,
      requests: prev.requests + u.requests,
      runs: prev.runs + 1,
      costUsd: prev.costUsd + u.costUsd,
    };
  }
  return out;
}

export const mockWorkstreams: Workstream[] = [
  {
    id: MOCK_WORKSTREAM_IDS.active,
    traceId: `trace_${MOCK_WORKSTREAM_IDS.active}`,
    title: 'Auth refactor: JWT sessions',
    goal: 'Replace cookie sessions with JWT access + refresh tokens and update login flow.',
    status: 'in_progress',
    summary:
      'Planning complete. Worker is implementing middleware; one auth test still failing.',
    repoUrl: 'https://github.com/acme/platform',
    createdAt: T0,
    updatedAt: T3,
  },
  {
    id: MOCK_WORKSTREAM_IDS.done,
    traceId: `trace_${MOCK_WORKSTREAM_IDS.done}`,
    title: 'Docs cleanup',
    goal: 'Remove stale README sections and align API docs with current endpoints.',
    status: 'done',
    summary: 'Updated 12 doc pages; removed deprecated webhook section.',
    createdAt: '2026-06-25T14:00:00.000Z',
    updatedAt: '2026-06-25T16:30:00.000Z',
  },
  {
    id: MOCK_WORKSTREAM_IDS.planning,
    traceId: `trace_${MOCK_WORKSTREAM_IDS.planning}`,
    title: 'Public API v2 design',
    goal: 'Draft OpenAPI spec and migration guide for v2 breaking changes.',
    status: 'paused_quota',
    quotaPausedStatus: 'planning',
    summary:
      '[System] Paused: usage quota reached. Resumes around 2026-06-28T20:00:00.000Z.',
    createdAt: T4,
    updatedAt: T4,
  },
];

export const mockMessages: Message[] = [
  {
    id: MOCK_MESSAGE_IDS.hello,
    direction: 'inbound',
    content: 'Good morning — what are you working on?',
    createdAt: '2026-06-26T09:55:00.000Z',
  },
  {
    id: 'msg-out-001',
    direction: 'outbound',
    content:
      'Morning! I have an auth refactor in progress and finished the docs cleanup yesterday.',
    createdAt: '2026-06-26T09:56:00.000Z',
  },
  {
    id: MOCK_MESSAGE_IDS.refactor,
    direction: 'inbound',
    content:
      'Please refactor auth to use JWT sessions with refresh token rotation.',
    createdAt: T0,
    workstreamId: MOCK_WORKSTREAM_IDS.active,
  },
  {
    id: MOCK_MESSAGE_IDS.docs,
    direction: 'inbound',
    content:
      'Clean up the README and API docs — lots of stale webhook references.',
    createdAt: '2026-06-25T14:00:00.000Z',
    workstreamId: MOCK_WORKSTREAM_IDS.done,
  },
  {
    id: 'msg-md-verify-temp',
    direction: 'outbound',
    content:
      '**Markdown check:** here is a [link](https://example.com), a list:\n\n- one\n- two\n\nand some code:\n\n```ts\nconst x = 1;\n```',
    createdAt: '2026-06-26T10:00:00.000Z',
  },
];

const authTasks: Task[] = [
  {
    id: 'task-plan-1',
    workstreamId: MOCK_WORKSTREAM_IDS.active,
    role: 'planner',
    description: 'Draft migration plan for JWT sessions',
    status: 'done',
    result: 'Plan written; reviewer approved.',
    runId: 'run-plan-1',
    parentRunId: 'run-orch-1',
    createdAt: T1,
    updatedAt: T2,
  },
  {
    id: 'task-worker-1',
    workstreamId: MOCK_WORKSTREAM_IDS.active,
    role: 'worker',
    description: 'Implement JWT middleware and update login handler',
    status: 'running',
    runId: 'run-worker-1',
    parentRunId: 'run-plan-1',
    createdAt: T2,
    updatedAt: T3,
  },
  {
    id: 'task-review-1',
    workstreamId: MOCK_WORKSTREAM_IDS.active,
    role: 'reviewer',
    description: 'Review migration plan',
    status: 'done',
    result: 'Approved with minor rotation interval note.',
    runId: 'run-review-1',
    parentRunId: 'run-orch-1',
    createdAt: T2,
    updatedAt: T3,
  },
];

export const mockWorkstreamDetails: Record<string, WorkstreamDetail> = {
  [MOCK_WORKSTREAM_IDS.active]: {
    workstream: mockWorkstreams[0],
    tasks: authTasks,
    reviews: [
      {
        id: 'rev-1',
        workstreamId: MOCK_WORKSTREAM_IDS.active,
        target: 'Migration plan',
        notes: 'Looks good. Consider 7-day refresh rotation instead of 30.',
        approved: true,
        stage: 'plan',
        severity: 'minor',
        createdAt: T3,
      },
    ],
    plan: `# Auth refactor plan

1. Add \`JwtService\` with access + refresh token pair generation
2. Replace \`SessionStore\` middleware with JWT validation
3. Update login/logout routes and client cookie handling
4. Migrate existing sessions on first login (grace period 14 days)
5. Add integration tests for rotation + revocation`,
    runs: wsAuthRuns,
    tree: buildTree(wsAuthRuns),
    progress: {
      reviewCycles: { count: 1, max: 3 },
      workerRunsSinceReview: { count: 2, max: 3 },
      noProgressRepeats: { count: 0, max: 2 },
      consecutiveFailedRuns: { count: 0, max: 3 },
      plannerAttempts: { count: 0, max: 3 },
      totalRuns: { count: wsAuthRuns.length, max: 20 },
    },
    usage: {
      total: summarizeRuns(wsAuthRuns),
      byRole: byRole(wsAuthRuns),
      byTask: byTask(wsAuthRuns),
    },
  },
  [MOCK_WORKSTREAM_IDS.done]: {
    workstream: mockWorkstreams[1],
    tasks: [
      {
        id: 'task-docs-1',
        workstreamId: MOCK_WORKSTREAM_IDS.done,
        role: 'worker',
        description: 'Update README and API reference',
        status: 'done',
        result: '12 pages updated.',
        createdAt: '2026-06-25T14:05:00.000Z',
        updatedAt: '2026-06-25T16:30:00.000Z',
      },
    ],
    reviews: [],
    plan: null,
    runs: [],
    tree: [],
    progress: {
      reviewCycles: { count: 0, max: 3 },
      workerRunsSinceReview: { count: 0, max: 3 },
      noProgressRepeats: { count: 0, max: 2 },
      consecutiveFailedRuns: { count: 0, max: 3 },
      plannerAttempts: { count: 0, max: 3 },
      totalRuns: { count: 0, max: 20 },
    },
    usage: {
      total: usage({
        inputTokens: 4200,
        outputTokens: 1800,
        costUsd: 0.024,
        runs: 2,
        requests: 2,
      }),
      byRole: {
        worker: usage({
          inputTokens: 4200,
          outputTokens: 1800,
          costUsd: 0.024,
          runs: 2,
          requests: 2,
        }),
      },
      byTask: {
        'task-docs-1': usage({
          inputTokens: 4200,
          outputTokens: 1800,
          costUsd: 0.024,
          runs: 2,
          requests: 2,
        }),
      },
    },
  },
  [MOCK_WORKSTREAM_IDS.planning]: {
    workstream: mockWorkstreams[2],
    tasks: [],
    reviews: [],
    plan: null,
    runs: [],
    tree: [],
    progress: {
      reviewCycles: { count: 0, max: 3 },
      workerRunsSinceReview: { count: 0, max: 3 },
      noProgressRepeats: { count: 0, max: 2 },
      consecutiveFailedRuns: { count: 0, max: 3 },
      plannerAttempts: { count: 0, max: 3 },
      totalRuns: { count: 0, max: 20 },
    },
    usage: {
      total: usage({
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        runs: 0,
        requests: 0,
      }),
      byRole: {},
      byTask: {},
    },
  },
};

export const mockMemories: Memory[] = [
  {
    id: 'mem-1',
    title: 'Code style',
    content:
      'Prefer tabs over spaces in TypeScript files. Max line length 100.',
    summary: 'Indentation and formatting preferences',
    tags: ['style', 'typescript'],
    kind: 'preference',
    source: 'conversation',
    createdAt: '2026-06-20T12:00:00.000Z',
    updatedAt: '2026-06-20T12:00:00.000Z',
  },
  {
    id: 'mem-2',
    title: 'Deploy checklist',
    content: `# Production deploy

- Run \`pnpm test\` and \`pnpm type-check\`
- Bump version in package.json
- Tag release and push to main
- Monitor CloudWatch for 15 minutes`,
    summary: 'Steps before shipping to production',
    tags: ['deploy', 'ops'],
    kind: 'document',
    source: 'https://wiki.acme.internal/deploy',
    createdAt: '2026-06-22T09:00:00.000Z',
  },
  {
    id: 'mem-3',
    content:
      'The team uses pnpm workspaces; never run npm install at repo root.',
    tags: ['tooling'],
    kind: 'note',
    source: 'onboarding',
    createdAt: '2026-06-24T11:00:00.000Z',
  },
];

export const mockModelConfig: ModelConfig = {
  tiers: {
    low: 'claude-haiku-4-20250514',
    medium: 'claude-sonnet-4-20250514',
    high: 'claude-opus-4-20250514',
  },
  roleTiers: {
    communicator: 'low',
    orchestrator: 'high',
    planner: 'medium',
    reviewer: 'low',
    worker: 'medium',
    librarian: 'low',
    receipt: 'low',
  },
  activePresetId: 'balanced',
  presets: [
    {
      id: 'balanced',
      name: 'Balanced',
      description: 'Sonnet for planning/work, Haiku for comms and review.',
      tiers: {
        low: 'claude-haiku-4-20250514',
        medium: 'claude-sonnet-4-20250514',
        high: 'claude-opus-4-20250514',
      },
      roleTiers: {
        communicator: 'low',
        orchestrator: 'high',
        planner: 'medium',
        reviewer: 'low',
        worker: 'medium',
        librarian: 'low',
        receipt: 'low',
      },
    },
    {
      id: 'economy',
      name: 'Economy',
      description: 'Haiku everywhere except orchestrator escalation.',
      tiers: {
        low: 'claude-haiku-4-20250514',
        medium: 'claude-haiku-4-20250514',
        high: 'claude-sonnet-4-20250514',
      },
      roleTiers: {
        communicator: 'low',
        orchestrator: 'high',
        planner: 'medium',
        reviewer: 'low',
        worker: 'medium',
        librarian: 'low',
        receipt: 'low',
      },
    },
  ],
  catalog: [
    {
      id: 'claude-haiku-4-20250514',
      provider: 'Anthropic',
      pricing: {
        inputPerMTok: 0.8,
        outputPerMTok: 4,
        cacheWritePerMTok: 1,
        cacheReadPerMTok: 0.08,
      },
    },
    {
      id: 'claude-sonnet-4-20250514',
      provider: 'Anthropic',
      pricing: {
        inputPerMTok: 3,
        outputPerMTok: 15,
        cacheWritePerMTok: 3.75,
        cacheReadPerMTok: 0.3,
      },
    },
    {
      id: 'claude-opus-4-20250514',
      provider: 'Anthropic',
      pricing: {
        inputPerMTok: 15,
        outputPerMTok: 75,
        cacheWritePerMTok: 18.75,
        cacheReadPerMTok: 1.5,
      },
    },
  ],
};

export const mockBenchSuites: BenchSuiteCatalogEntry[] = [
  {
    id: 'swebench-lite',
    kind: 'swebench',
    name: 'SWE-bench Lite',
    description: '300 curated instances for faster iteration',
    taskCount: 300,
    runCommand: 'pnpm bench --suite swebench-lite',
    evalCommand: 'pnpm bench eval',
  },
];

const benchTree = buildTree(wsAuthRuns.slice(0, 3));

export const mockBenchOverview: BenchOverview = {
  generatedAt: T4,
  graded: true,
  modelName: 'claude-sonnet-4-20250514',
  models: {
    low: 'claude-haiku-4-20250514',
    medium: 'claude-sonnet-4-20250514',
    high: 'claude-opus-4-20250514',
  },
  suiteKind: 'swebench',
  suiteName: 'SWE-bench Lite',
  suiteDescription: '300 curated instances',
  summary: {
    instances: 3,
    resolved: 2,
    resolveRate: 0.667,
    totalCostUsd: 0.42,
    costPerSolvedUsd: 0.21,
    avgCostUsd: 0.14,
    totalRuns: 12,
    inputTokens: 48000,
    outputTokens: 12000,
  },
  instances: [
    {
      instanceId: MOCK_BENCH_INSTANCE,
      repo: 'django/django',
      outcome: 'resolved',
      resolved: true,
      durationMs: 245_000,
      patchBytes: 1842,
      costUsd: 0.18,
      runs: 5,
      inputTokens: 22000,
      outputTokens: 5800,
      hasTrajectory: true,
    },
    {
      instanceId: 'requests__requests-5678',
      repo: 'psf/requests',
      outcome: 'resolved',
      resolved: true,
      durationMs: 128_000,
      patchBytes: 920,
      costUsd: 0.11,
      runs: 4,
      inputTokens: 14000,
      outputTokens: 3200,
      hasTrajectory: true,
    },
    {
      instanceId: 'flask__flask-9012',
      repo: 'pallets/flask',
      outcome: 'unresolved',
      resolved: false,
      durationMs: 310_000,
      patchBytes: 2100,
      costUsd: 0.13,
      runs: 3,
      inputTokens: 12000,
      outputTokens: 3000,
      hasTrajectory: false,
    },
  ],
  instanceEfficiency: [
    {
      id: MOCK_BENCH_INSTANCE,
      label: MOCK_BENCH_INSTANCE,
      costUsd: 0.18,
      scorePct: 100,
      kind: 'instance',
      resolved: true,
    },
    {
      id: 'requests__requests-5678',
      label: 'requests__requests-5678',
      costUsd: 0.11,
      scorePct: 100,
      kind: 'instance',
      resolved: true,
    },
    {
      id: 'flask__flask-9012',
      label: 'flask__flask-9012',
      costUsd: 0.13,
      scorePct: 0,
      kind: 'instance',
      resolved: false,
    },
  ],
  runEfficiency: [
    {
      id: 'run-plan-1',
      label: 'planner',
      costUsd: 0.056,
      scorePct: 40,
      kind: 'run',
      resolved: true,
    },
    {
      id: 'run-worker-1',
      label: 'worker',
      costUsd: 0.112,
      scorePct: 60,
      kind: 'run',
      resolved: null,
      isCurrent: true,
    },
  ],
};

export const mockBenchRunDetail: BenchRunDetail = {
  instanceId: MOCK_BENCH_INSTANCE,
  repo: 'django/django',
  baseCommit: 'abc123def',
  outcome: 'resolved',
  resolved: true,
  problemStatement:
    'Fix QuerySet.distinct() crash when combined with select_related on nullable FK.',
  modelName: 'claude-sonnet-4-20250514',
  models: mockBenchOverview.models,
  durationMs: 245_000,
  patchBytes: 1842,
  usage: summarizeRuns(wsAuthRuns.slice(0, 3)),
  byRole: byRole(wsAuthRuns.slice(0, 3)),
  patch: `diff --git a/django/db/models/query.py b/django/db/models/query.py
--- a/django/db/models/query.py
+++ b/django/db/models/query.py
@@ -1120,6 +1120,9 @@ class QuerySet:
     def distinct(self, *field_names):
+        if self.query.select_related and not field_names:
+            raise ValueError("distinct() with select_related requires field_names")
         return self._chain()`,
  verifier: { status: 'resolved', note: 'All tests passed' },
  trajectory: benchTree,
};

export function buildUsageOverview(
  messages: Message[],
  workstreamDetails: Record<string, WorkstreamDetail>,
) {
  const allRuns = Object.values(workstreamDetails).flatMap((d) => d.runs);
  const total = summarizeRuns(allRuns);
  const byWorkstream: Record<string, UsageSummary> = {};
  for (const [id, detail] of Object.entries(workstreamDetails)) {
    byWorkstream[id] = detail.usage.total;
  }
  const byRoute: Record<string, UsageSummary> = {
    primary: { ...total },
    'zen-failover': usage({
      inputTokens: 1200,
      outputTokens: 400,
      costUsd: 0.012,
      runs: 1,
      requests: 1,
    }),
  };
  return {
    total,
    byRole: byRole(allRuns),
    byModel: {
      'claude-sonnet-4-20250514': usage({
        inputTokens: 28000,
        outputTokens: 7200,
        costUsd: 0.18,
        runs: 4,
        requests: 4,
      }),
      'claude-haiku-4-20250514': usage({
        inputTokens: 3100,
        outputTokens: 420,
        costUsd: 0.008,
        runs: 1,
        requests: 1,
      }),
    },
    byWorkstream,
    byMessage: messages
      .filter((m) => m.direction === 'inbound')
      .map((m) => ({
        messageId: m.id,
        createdAt: m.createdAt,
        content:
          m.content.length > 140 ? `${m.content.slice(0, 140)}…` : m.content,
        usage:
          workstreamDetails[m.workstreamId ?? '']?.usage.total ??
          usage({
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            runs: 0,
            requests: 0,
          }),
      })),
    byRoute,
    quota: mockQuotaSnapshot,
  };
}

export const mockQuotaSnapshot: QuotaSnapshot = {
  reservePercent: 10,
  activeRoutes: { 'opencode-go': 'zen-failover' },
  pausedWorkstreams: { [MOCK_WORKSTREAM_IDS.planning]: 'planning' },
  accounts: {
    'opencode-go': {
      config: {
        id: 'opencode-go',
        mode: 'windowed',
        onExhausted: 'failover',
        windows: [
          {
            id: 'rolling5h',
            unit: 'dollars',
            period: 'rolling5h',
            scope: 'global',
            limit: 12,
            blockAtPercent: 90,
          },
        ],
        failover: [
          {
            id: 'zen-failover',
            accountId: 'opencode-zen',
            llm: {
              baseURL: 'https://opencode.ai/zen/v1',
              preset: 'zen-balanced',
            },
            onExhausted: 'wait',
          },
        ],
      },
      status: 'exhausted',
      updatedAt: T4,
      windows: [
        {
          config: {
            id: 'rolling5h',
            unit: 'dollars',
            period: 'rolling5h',
            scope: 'global',
            limit: 12,
            warnAtPercent: 70,
            blockAtPercent: 90,
          },
          used: 11.2,
          usedByWorkstream: {},
          rollingEntries: [{ amount: 11.2, at: T4 }],
          resetsAt: '2026-06-28T20:00:00.000Z',
          source: 'estimated',
        },
      ],
    },
    'opencode-zen': {
      config: {
        id: 'opencode-zen',
        mode: 'metered',
        onExhausted: 'wait',
        windows: [
          {
            id: 'daily-budget',
            unit: 'dollars',
            period: 'daily',
            scope: 'global',
            limit: 10,
            blockAtPercent: 90,
          },
        ],
      },
      status: 'warning',
      updatedAt: T4,
      windows: [
        {
          config: {
            id: 'daily-budget',
            unit: 'dollars',
            period: 'daily',
            scope: 'global',
            limit: 10,
            warnAtPercent: 70,
            blockAtPercent: 90,
          },
          used: 7.4,
          usedByWorkstream: {},
          rollingEntries: [],
          resetsAt: '2026-06-29T00:00:00.000Z',
          source: 'metered',
        },
      ],
    },
  },
};

export const mockQuotaConfig: QuotaConfig = {
  reservePercent: mockQuotaSnapshot.reservePercent,
  routes: [
    {
      id: 'primary',
      accountId: 'opencode-go',
      mode: 'windowed',
      execution: 'llm',
      llm: { baseURL: 'https://opencode.ai/zen/go/v1' },
      presetId: 'go-economy',
      models: { low: 'kimi-k2.5', medium: 'kimi-k2.6', high: 'kimi-k2.6' },
      windows: mockQuotaSnapshot.accounts['opencode-go']!.windows.map(
        (w) => w.config,
      ),
    },
    {
      id: 'zen-failover',
      accountId: 'opencode-zen',
      mode: 'metered',
      execution: 'llm',
      llm: { baseURL: 'https://opencode.ai/zen/v1' },
      presetId: 'zen-balanced',
      models: { low: 'glm-4.7-flash', medium: 'glm-4.7', high: 'glm-4.7' },
      windows: mockQuotaSnapshot.accounts['opencode-zen']!.windows.map(
        (w) => w.config,
      ),
    },
  ],
};

function traceEvent(
  partial: Pick<TraceEvent, 'id' | 'traceId' | 'sequence' | 'at' | 'kind'> &
    Partial<TraceEvent>,
): TraceEvent {
  return {
    schemaVersion: 1,
    data: {},
    ...partial,
  };
}

const activeTraceId = `trace_${MOCK_WORKSTREAM_IDS.active}`;
const doneTraceId = `trace_${MOCK_WORKSTREAM_IDS.done}`;

export const mockTraces: Record<string, WorkstreamTraceResponse> = {
  [MOCK_WORKSTREAM_IDS.active]: {
    trace: {
      schemaVersion: 1,
      id: activeTraceId,
      workstreamId: MOCK_WORKSTREAM_IDS.active,
      originMessageId: MOCK_MESSAGE_IDS.refactor,
      agentName: 'Artificer (mock)',
      title: mockWorkstreams[0].title,
      goal: mockWorkstreams[0].goal,
      status: 'in_progress',
      summary: mockWorkstreams[0].summary,
      createdAt: T0,
      updatedAt: T3,
      startedAt: T0,
      repo: {
        remoteUrl: mockWorkstreams[0].repoUrl,
        branch: 'feat/jwt-auth',
      },
      eventCount: 8,
      lastSequence: 8,
    },
    events: [
      traceEvent({
        id: 'evt-1',
        traceId: activeTraceId,
        sequence: 1,
        at: T0,
        kind: 'message',
        data: {
          direction: 'inbound',
          content:
            'Please refactor auth to use JWT sessions with refresh token rotation.',
        },
      }),
      traceEvent({
        id: 'evt-2',
        traceId: activeTraceId,
        sequence: 2,
        at: T0,
        kind: 'workstream',
        sourceId: MOCK_WORKSTREAM_IDS.active,
        data: {
          event: 'created',
          status: 'planning',
          title: mockWorkstreams[0].title,
        },
      }),
      traceEvent({
        id: 'evt-3',
        traceId: activeTraceId,
        sequence: 3,
        at: T1,
        kind: 'run',
        runId: 'run-plan-1',
        parentRunId: 'run-orch-1',
        actor: { kind: 'role', role: 'planner' },
        data: {
          role: 'planner',
          status: 'done',
          task: 'Draft migration plan for JWT sessions',
        },
      }),
      traceEvent({
        id: 'evt-4',
        traceId: activeTraceId,
        sequence: 4,
        at: T2,
        kind: 'review',
        data: {
          target: 'Migration plan',
          approved: true,
          severity: 'minor',
        },
      }),
      traceEvent({
        id: 'evt-5',
        traceId: activeTraceId,
        sequence: 5,
        at: T2,
        kind: 'artifact',
        data: { key: 'plan', version: 'v1', action: 'created' },
      }),
      traceEvent({
        id: 'evt-6',
        traceId: activeTraceId,
        sequence: 6,
        at: T2,
        kind: 'run',
        runId: 'run-worker-1',
        parentRunId: 'run-plan-1',
        actor: { kind: 'role', role: 'worker' },
        data: {
          role: 'worker',
          status: 'running',
          task: 'Implement JWT middleware and update login handler',
        },
      }),
      traceEvent({
        id: 'evt-7',
        traceId: activeTraceId,
        sequence: 7,
        at: T3,
        kind: 'tool',
        runId: 'run-worker-1',
        data: { name: 'run_tests', error: '1 test failed' },
      }),
      traceEvent({
        id: 'evt-8',
        traceId: activeTraceId,
        sequence: 8,
        at: T3,
        kind: 'workstream',
        sourceId: MOCK_WORKSTREAM_IDS.active,
        data: { event: 'updated', status: 'in_progress' },
      }),
    ],
    hasMore: false,
  },
  [MOCK_WORKSTREAM_IDS.done]: {
    trace: {
      schemaVersion: 1,
      id: doneTraceId,
      workstreamId: MOCK_WORKSTREAM_IDS.done,
      agentName: 'Artificer (mock)',
      title: mockWorkstreams[1].title,
      goal: mockWorkstreams[1].goal,
      status: 'done',
      summary: mockWorkstreams[1].summary,
      createdAt: mockWorkstreams[1].createdAt,
      updatedAt: mockWorkstreams[1].updatedAt,
      finishedAt: mockWorkstreams[1].updatedAt,
      eventCount: 3,
      lastSequence: 3,
    },
    events: [
      traceEvent({
        id: 'evt-d1',
        traceId: doneTraceId,
        sequence: 1,
        at: mockWorkstreams[1].createdAt,
        kind: 'workstream',
        data: { event: 'created', status: 'in_progress' },
      }),
      traceEvent({
        id: 'evt-d2',
        traceId: doneTraceId,
        sequence: 2,
        at: '2026-06-25T16:00:00.000Z',
        kind: 'artifact',
        data: { key: 'report', version: 'v1', action: 'released' },
      }),
      traceEvent({
        id: 'evt-d3',
        traceId: doneTraceId,
        sequence: 3,
        at: mockWorkstreams[1].updatedAt,
        kind: 'receipt',
        data: { schemaVersion: 1 },
      }),
    ],
    hasMore: false,
  },
};

export const mockReceipts: Record<string, WorkstreamReceiptResponse> = {
  [MOCK_WORKSTREAM_IDS.active]: {
    receipt: {
      schemaVersion: 1,
      id: 'rcpt-auth-refactor',
      workstreamId: MOCK_WORKSTREAM_IDS.active,
      traceId: activeTraceId,
      title: mockWorkstreams[0].title,
      goal: mockWorkstreams[0].goal,
      status: 'in_progress',
      summary: mockWorkstreams[0].summary,
      nextAction: 'Fix failing auth integration test and rerun the suite.',
      createdAt: T0,
      updatedAt: T3,
      startedAt: T0,
      steps: [
        {
          id: 'step-1',
          order: 1,
          role: 'planner',
          label: 'Draft migration plan',
          status: 'done',
          summary: 'JWT + refresh rotation plan approved.',
          runIds: ['run-plan-1'],
          taskIds: ['task-plan-1'],
          startedAt: T1,
          finishedAt: T2,
        },
        {
          id: 'step-2',
          order: 2,
          role: 'worker',
          label: 'Implement JWT middleware',
          status: 'running',
          summary: 'Middleware written; one auth test failing.',
          runIds: ['run-worker-1'],
          taskIds: ['task-worker-1'],
          startedAt: T2,
        },
      ],
      changes: {
        repositoryUrl: mockWorkstreams[0].repoUrl,
        branch: 'feat/jwt-auth',
        files: [
          'src/auth/jwt.ts',
          'src/auth/session.ts',
          'src/routes/login.ts',
        ],
        commits: ['abc1234 feat(auth): add JWT middleware'],
      },
      validation: [
        {
          label: 'auth tests',
          command: 'pnpm test auth',
          status: 'failed',
          summary: '3 passed, 1 failed',
          runId: 'run-worker-1',
        },
      ],
      reviews: [
        {
          id: 'rcpt-rev-1',
          stage: 'plan',
          target: 'Migration plan',
          approved: true,
          severity: 'minor',
          summary: 'Approved with rotation interval note.',
          sourceReviewId: 'rev-1',
        },
      ],
      findings: [],
      usage: {
        runCount: 4,
        inputTokens: 32100,
        outputTokens: 7400,
        modelRequests: 4,
        estimatedCostDollars: 0.204,
        durationMs: 28 * 60 * 1000,
      },
      links: {
        localUrl: `/workstreams/${MOCK_WORKSTREAM_IDS.active}`,
        artifactUrls: [
          `/workstreams/${MOCK_WORKSTREAM_IDS.active}/artifacts/plan`,
        ],
      },
      provenance: {
        generatedFromTraceSequence: 8,
        sourceUpdatedAt: T3,
        redactionPolicyVersion: '2026-03-01',
      },
    },
    markdown: `# ${mockWorkstreams[0].title}

**Status:** in progress

Planning complete. Worker is implementing middleware; one auth test still failing.

## Next action

Fix failing auth integration test and rerun the suite.

## Changes

- \`src/auth/jwt.ts\`
- \`src/auth/session.ts\`
- \`src/routes/login.ts\`
`,
  },
  [MOCK_WORKSTREAM_IDS.done]: {
    receipt: {
      schemaVersion: 1,
      id: 'rcpt-docs-cleanup',
      workstreamId: MOCK_WORKSTREAM_IDS.done,
      traceId: doneTraceId,
      title: mockWorkstreams[1].title,
      goal: mockWorkstreams[1].goal,
      status: 'done',
      summary: mockWorkstreams[1].summary,
      createdAt: mockWorkstreams[1].createdAt,
      updatedAt: mockWorkstreams[1].updatedAt,
      startedAt: mockWorkstreams[1].createdAt,
      finishedAt: mockWorkstreams[1].updatedAt,
      steps: [
        {
          id: 'step-docs-1',
          order: 1,
          role: 'worker',
          label: 'Update documentation',
          status: 'done',
          summary: '12 pages updated.',
          runIds: [],
          taskIds: ['task-docs-1'],
          finishedAt: mockWorkstreams[1].updatedAt,
        },
      ],
      changes: {
        files: ['README.md', 'docs/api/webhooks.md'],
        commits: ['def5678 docs: remove stale webhook references'],
      },
      validation: [],
      reviews: [],
      findings: [],
      usage: {
        runCount: 2,
        inputTokens: 4200,
        outputTokens: 1800,
        modelRequests: 2,
        estimatedCostDollars: 0.024,
        durationMs: 2.5 * 60 * 60 * 1000,
      },
      links: {
        localUrl: `/workstreams/${MOCK_WORKSTREAM_IDS.done}`,
      },
      provenance: {
        generatedFromTraceSequence: 3,
        sourceUpdatedAt: mockWorkstreams[1].updatedAt,
        redactionPolicyVersion: '2026-03-01',
      },
    },
    markdown: `# ${mockWorkstreams[1].title}

**Status:** done

Updated 12 doc pages; removed deprecated webhook section.
`,
  },
};

export const mockArtifacts: Record<string, WorkstreamArtifact[]> = {
  [MOCK_WORKSTREAM_IDS.active]: [
    {
      schemaVersion: 1,
      id: 'art-plan-auth',
      workstreamId: MOCK_WORKSTREAM_IDS.active,
      traceId: activeTraceId,
      key: 'plan',
      name: 'Migration plan',
      description: 'Approved plan for JWT session migration.',
      contentType: 'text/markdown',
      createdAt: T1,
      updatedAt: T2,
      currentVersion: 'v1',
      approvalStatus: 'approved',
      visibility: 'private',
      versions: [
        {
          version: 'v1',
          contentType: 'text/markdown',
          sha256:
            'a1b2c3d4e5f6789012345678901234567890abcd1234567890abcd123456',
          byteSize: 512,
          createdAt: T2,
          createdByRunId: 'run-plan-1',
          sourceTraceSequence: 5,
          state: 'released',
          releasedAt: T2,
        },
      ],
    },
    {
      schemaVersion: 1,
      id: 'art-diff-auth',
      workstreamId: MOCK_WORKSTREAM_IDS.active,
      traceId: activeTraceId,
      key: 'diff',
      name: 'Working diff',
      contentType: 'text/plain',
      createdAt: T2,
      updatedAt: T3,
      approvalStatus: 'not_requested',
      visibility: 'private',
      versions: [
        {
          version: 'v1',
          contentType: 'text/plain',
          sha256:
            'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
          byteSize: 2048,
          createdAt: T3,
          createdByRunId: 'run-worker-1',
          sourceTraceSequence: 7,
          state: 'ready',
        },
      ],
    },
  ],
  [MOCK_WORKSTREAM_IDS.done]: [
    {
      schemaVersion: 1,
      id: 'art-report-docs',
      workstreamId: MOCK_WORKSTREAM_IDS.done,
      traceId: doneTraceId,
      key: 'report',
      name: 'Docs cleanup report',
      contentType: 'text/markdown',
      createdAt: '2026-06-25T16:00:00.000Z',
      updatedAt: mockWorkstreams[1].updatedAt,
      currentVersion: 'v1',
      approvalStatus: 'approved',
      visibility: 'link',
      versions: [
        {
          version: 'v1',
          contentType: 'text/markdown',
          sha256:
            '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          byteSize: 768,
          createdAt: '2026-06-25T16:00:00.000Z',
          state: 'released',
          releasedAt: mockWorkstreams[1].updatedAt,
        },
      ],
    },
  ],
};

export const mockArtifactContent: Record<string, string> = {
  [`${MOCK_WORKSTREAM_IDS.active}:plan:v1`]: `# Auth refactor plan

1. Add \`JwtService\` with access + refresh token pair generation
2. Replace \`SessionStore\` middleware with JWT validation
3. Update login/logout routes and client cookie handling
4. Migrate existing sessions on first login (grace period 14 days)
5. Add integration tests for rotation + revocation`,
  [`${MOCK_WORKSTREAM_IDS.active}:diff:v1`]: `diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/jwt.ts
@@ -0,0 +1,84 @@
+export class JwtService {
+  // ...
+}`,
  [`${MOCK_WORKSTREAM_IDS.done}:report:v1`]: `# Docs cleanup report

- Updated README quickstart
- Removed deprecated webhook section from API docs
- Aligned endpoint examples with v1.4 schema`,
};
