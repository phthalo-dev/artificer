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
  kind?: 'note' | 'document';
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

export interface Review {
  id: string;
  workstreamId: string;
  target: string;
  notes: string;
  approved: boolean;
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
