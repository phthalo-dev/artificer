// Local mirror of the @artificer-ai/runtime HTTP API response shapes.

export type RoleName =
  | 'communicator'
  | 'orchestrator'
  | 'planner'
  | 'reviewer'
  | 'worker'
  | 'librarian'
  | 'receipt';

export type MemoryKind =
  | 'note'
  | 'document'
  | 'preference'
  | 'claim'
  | 'entity';

export type MemoryEdgeType =
  | 'related'
  | 'builds_on'
  | 'contradicts'
  | 'cites'
  | 'categorized_under';

export interface MemoryRelation {
  id: string;
  type: MemoryEdgeType;
}

export interface Memory {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  title?: string;
  summary?: string;
  source?: string;
  kind?: MemoryKind;
  related?: MemoryRelation[];
  sourceHash?: string;
  sourceCommit?: string;
  updatedAt?: string;
}

export type MessageDirection = 'inbound' | 'outbound';

export interface Message {
  id: string;
  direction: MessageDirection;
  content: string;
  createdAt: string;
  workstreamId?: string;
}

export type WorkstreamStatus =
  | 'pending'
  | 'planning'
  | 'reviewing'
  | 'in_progress'
  | 'paused_quota'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface Workstream {
  id: string;
  traceId?: string;
  title: string;
  goal: string;
  status: WorkstreamStatus;
  /** Status restored when a quota pause lifts. */
  quotaPausedStatus?: WorkstreamStatus;
  summary: string;
  repoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Task {
  id: string;
  workstreamId: string;
  role: RoleName;
  description: string;
  status: TaskStatus;
  result?: string;
  runId?: string;
  parentRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ReviewStage = 'plan' | 'work';
export type ReviewSeverity = 'critical' | 'important' | 'minor' | 'none';

export interface Review {
  id: string;
  workstreamId: string;
  target: string;
  notes: string;
  approved: boolean;
  stage?: ReviewStage;
  severity?: ReviewSeverity;
  createdAt: string;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ToolInvocation {
  name: string;
  input: unknown;
  output: string;
  error?: string;
  at: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requests: number;
}

export interface RunRecord {
  id: string;
  role: RoleName;
  task: string;
  workstreamId?: string;
  taskId?: string;
  parentRunId?: string;
  originMessageId?: string;
  model?: string;
  executor?: string;
  routeProfileId?: string;
  routeAccountId?: string;
  status: RunStatus;
  toolCalls: ToolInvocation[];
  usage: TokenUsage;
  output?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface UsageSummary extends TokenUsage {
  runs: number;
  costUsd: number;
}

export interface RunNode {
  run: RunRecord;
  self: UsageSummary;
  cumulative: UsageSummary;
  children: RunNode[];
}

export interface ActiveRun {
  runId: string;
  role: string;
  workstreamId?: string;
  startedAt: string;
}

export interface RuntimeState {
  agentName: string;
  busy: boolean;
  queue: { pending: number; running: number };
  activeRuns: ActiveRun[];
  workstreams: Array<
    Pick<Workstream, 'id' | 'title' | 'status' | 'summary' | 'updatedAt'>
  >;
}

export interface RetryCounter {
  count: number;
  max: number;
}

export interface WorkstreamProgress {
  reviewCycles: RetryCounter;
  workerRunsSinceReview: RetryCounter;
  noProgressRepeats: RetryCounter;
  consecutiveFailedRuns: RetryCounter;
  plannerAttempts: RetryCounter;
  totalRuns: RetryCounter;
}

export interface ReceiptStep {
  id: string;
  order: number;
  role: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  summary?: string;
  runIds: string[];
  taskIds: string[];
  startedAt?: string;
  finishedAt?: string;
}

export interface ReceiptChanges {
  repositoryUrl?: string;
  baseCommit?: string;
  headCommit?: string;
  branch?: string;
  files: string[];
  commits: string[];
  pullRequestUrl?: string;
}

export interface ReceiptValidation {
  label: string;
  command?: string;
  status: 'passed' | 'failed' | 'skipped' | 'unknown';
  summary?: string;
  runId?: string;
}

export interface ReceiptReview {
  id: string;
  stage?: 'plan' | 'work';
  target: string;
  approved: boolean;
  severity?: 'critical' | 'important' | 'minor' | 'none';
  summary: string;
  sourceReviewId: string;
}

export interface ReceiptFinding {
  id: string;
  role: string;
  file?: string;
  summary: string;
  sourceFindingId: string;
}

export interface ReceiptUsage {
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  modelRequests: number;
  estimatedCostDollars?: number;
  durationMs?: number;
}

export interface ReceiptLinks {
  localUrl: string;
  externalUrl?: string;
  artifactUrls?: string[];
}

export interface ReceiptProvenance {
  generatedFromTraceSequence?: number;
  generatedByRunId?: string;
  sourceUpdatedAt: string;
  redactionPolicyVersion: string;
}

export interface WorkstreamReceipt {
  schemaVersion: 1;
  id: string;
  workstreamId: string;
  traceId?: string;
  title: string;
  goal: string;
  status: WorkstreamStatus;
  summary: string;
  nextAction?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  steps: ReceiptStep[];
  changes: ReceiptChanges;
  validation: ReceiptValidation[];
  reviews: ReceiptReview[];
  findings: ReceiptFinding[];
  usage: ReceiptUsage;
  links: ReceiptLinks;
  provenance: ReceiptProvenance;
}

export interface WorkstreamReceiptResponse {
  receipt: WorkstreamReceipt;
  markdown: string;
}

export interface WorkstreamDetail {
  workstream: Workstream;
  tasks: Task[];
  reviews: Review[];
  plan: string | null;
  runs: RunRecord[];
  tree?: RunNode[];
  progress: WorkstreamProgress;
  usage: {
    total: UsageSummary;
    byTask: Record<string, UsageSummary>;
    byRole: Record<string, UsageSummary>;
  };
}

export interface MessageUsageRow {
  messageId: string;
  createdAt: string;
  content: string;
  usage: UsageSummary;
}

export interface UsageOverview {
  total: UsageSummary;
  byRole: Record<string, UsageSummary>;
  byModel: Record<string, UsageSummary>;
  byRoute: Record<string, UsageSummary>;
  byWorkstream: Record<string, UsageSummary>;
  byMessage: MessageUsageRow[];
  quota: QuotaSnapshot | null;
}

export type QuotaUnit = 'dollars' | 'tokens' | 'requests';
export type QuotaPeriod =
  | 'rolling5h'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'fixed';
export type QuotaScope = 'global' | 'workstream';
export type QuotaAccountStatus = 'ok' | 'warning' | 'exhausted' | 'unknown';
export type QuotaUsageSource =
  | 'metered'
  | 'provider'
  | 'estimated'
  | 'inferred';

export interface QuotaWindowConfig {
  id: string;
  unit: QuotaUnit;
  period: QuotaPeriod;
  scope?: QuotaScope;
  limit: number;
  warnAtPercent?: number;
  blockAtPercent?: number;
}

export interface QuotaWindowState {
  config: QuotaWindowConfig;
  used: number;
  usedByWorkstream: Record<string, number>;
  rollingEntries: Array<{ amount: number; at: string }>;
  windowStart?: string;
  resetsAt?: string;
  source: QuotaUsageSource;
}

export interface FailoverLlmConfig {
  baseURL: string;
  apiKeyEnv?: string;
  preset?: string;
}

export interface FailoverTargetConfig {
  id: string;
  accountId: string;
  roles?: string[];
  llm?: FailoverLlmConfig;
  executor?: 'llm' | 'cursor-agent' | 'claude-code' | 'opencode';
  onExhausted?: 'wait' | 'failover';
}

export interface QuotaAccountConfig {
  id: string;
  mode: 'metered' | 'windowed' | 'opaque';
  windows: QuotaWindowConfig[];
  onExhausted?: 'wait' | 'failover';
  failover?: FailoverTargetConfig[];
  pollIntervalMs?: number;
}

export interface ExecutionRouteConfig {
  id: string;
  accountId: string;
  mode: 'metered' | 'windowed' | 'opaque';
  windows: QuotaWindowConfig[];
  execution: 'llm' | 'cursor-agent' | 'claude-code' | 'opencode';
  llm?: {
    baseURL: string;
    apiKeyEnv?: string;
  };
  presetId?: string;
  models: ModelTiers;
  roleTiers?: Record<RoleName, ModelTier>;
  roles?: string[];
  pollIntervalMs?: number;
}

export interface QuotaConfig {
  reservePercent?: number;
  defaultEstimateDollars?: Partial<Record<'low' | 'medium' | 'high', number>>;
  routes?: ExecutionRouteConfig[];
  /** @deprecated Legacy shape — migrated to routes at runtime. */
  accounts?: QuotaAccountConfig[];
}

export interface QuotaConfigResponse {
  configured: QuotaConfig | null;
  effective: QuotaConfig | null;
  primaryAccountId: string;
  catalog: CatalogModel[];
  presets: ModelPresetInfo[];
}

export interface QuotaAccountState {
  config: QuotaAccountConfig;
  windows: QuotaWindowState[];
  status: QuotaAccountStatus;
  updatedAt: string;
}

export interface QuotaSnapshot {
  accounts: Record<string, QuotaAccountState>;
  activeRoutes: Record<string, string>;
  pausedWorkstreams: Record<string, string>;
  reservePercent: number;
}

export interface MessageCost {
  message: Message;
  total: UsageSummary;
  byWorkstream: Record<string, UsageSummary>;
  byRole: Record<string, UsageSummary>;
  tree: RunNode[];
}

// --- Benchmark harness (SWE-bench-style) ---

export interface BenchModels {
  low: string;
  medium: string;
  high: string;
}

export interface BenchInstanceSummary {
  instanceId: string;
  repo: string;
  outcome: string;
  resolved: boolean | null;
  durationMs: number;
  patchBytes: number;
  costUsd: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  hasTrajectory: boolean;
}

export interface BenchEfficiencyPoint {
  id: string;
  label: string;
  costUsd: number;
  scorePct: number;
  kind: 'instance' | 'run';
  resolved: boolean | null;
  isCurrent?: boolean;
}

export interface BenchSuiteCatalogEntry {
  id: string;
  kind: 'swebench' | 'deepswe' | 'greenfield';
  name: string;
  description?: string;
  taskCount: number;
  runCommand: string;
  evalCommand: string;
}

export interface BenchOverview {
  generatedAt: string | null;
  graded: boolean;
  modelName: string | null;
  models: BenchModels | null;
  suiteKind: 'swebench' | 'deepswe' | 'greenfield' | null;
  suiteName: string | null;
  suiteDescription: string | null;
  summary: {
    instances: number;
    resolved: number | null;
    resolveRate: number | null;
    totalCostUsd: number;
    costPerSolvedUsd: number | null;
    avgCostUsd: number;
    totalRuns: number;
    inputTokens: number;
    outputTokens: number;
  };
  instances: BenchInstanceSummary[];
  instanceEfficiency: BenchEfficiencyPoint[];
  runEfficiency: BenchEfficiencyPoint[];
}

export type VerifierStatus =
  | 'resolved'
  | 'unresolved'
  | 'empty_patch'
  | 'error'
  | 'ungraded';

export interface BenchRunDetail {
  instanceId: string;
  repo: string;
  baseCommit: string;
  outcome: string;
  resolved: boolean | null;
  problemStatement: string | null;
  modelName: string | null;
  models: BenchModels | null;
  durationMs: number;
  patchBytes: number;
  usage: UsageSummary | null;
  byRole: Record<string, UsageSummary>;
  patch: string | null;
  verifier: { status: VerifierStatus; note: string | null };
  trajectory: RunNode[] | null;
}

export type ModelTier = 'low' | 'medium' | 'high';

export interface ModelTiers {
  low: string;
  medium: string;
  high: string;
}

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export interface CatalogModel {
  id: string;
  provider: string;
  pricing: ModelPricing;
}

export interface ModelPresetInfo {
  id: string;
  name: string;
  description: string;
  tiers: ModelTiers;
  roleTiers: Record<RoleName, ModelTier>;
}

export interface ModelConfig {
  tiers: ModelTiers;
  roleTiers: Record<RoleName, ModelTier>;
  activePresetId: string;
  presets: ModelPresetInfo[];
  catalog: CatalogModel[];
}
