// Local mirror of the @artificer/runtime HTTP API response shapes.

export type RoleName =
  | 'communicator'
  | 'orchestrator'
  | 'planner'
  | 'reviewer'
  | 'worker'
  | 'librarian';

export interface Memory {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  title?: string;
  summary?: string;
  source?: string;
  kind?: 'note' | 'document' | 'preference';
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
  | 'blocked'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface Workstream {
  id: string;
  title: string;
  goal: string;
  status: WorkstreamStatus;
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

export interface WorkstreamDetail {
  workstream: Workstream;
  tasks: Task[];
  reviews: Review[];
  plan: string | null;
  runs: RunRecord[];
  tree?: RunNode[];
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
  byWorkstream: Record<string, UsageSummary>;
  byMessage: MessageUsageRow[];
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
  kind: 'swebench' | 'deepswe';
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
  suiteKind: 'swebench' | 'deepswe' | null;
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
