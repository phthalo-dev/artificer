export type RoleName =
  | 'communicator'
  | 'orchestrator'
  | 'planner'
  | 'reviewer'
  | 'worker'
  | 'librarian';

export type MessageDirection = 'inbound' | 'outbound';

export interface Message {
  id: string;
  direction: MessageDirection;
  content: string;
  createdAt: string;
  /** Set when the message is associated with a specific workstream. */
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
  title: string;
  /** The original request / objective driving this workstream. */
  goal: string;
  status: WorkstreamStatus;
  /** Status to restore when a quota pause lifts. */
  quotaPausedStatus?: WorkstreamStatus;
  /** Running summary the orchestrator maintains across calls. */
  summary: string;
  /** Optional repository this workstream operates on. */
  repoUrl?: string;
  /** Optional base commit to check out after cloning (bench / SWE tasks). */
  baseCommit?: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Task {
  id: string;
  workstreamId: string;
  role: string;
  description: string;
  status: TaskStatus;
  result?: string;
  runId?: string;
  parentRunId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Which lifecycle stage a review covered. */
export type ReviewStage = 'plan' | 'work';

/** Highest-severity issue a review surfaced; 'none' when nothing blocking. */
export type ReviewSeverity = 'critical' | 'important' | 'minor' | 'none';

export interface Review {
  id: string;
  workstreamId: string;
  /** What was reviewed (a plan, a file, a task result, etc.). */
  target: string;
  notes: string;
  approved: boolean;
  /** Whether the plan or the implemented work was reviewed. */
  stage?: ReviewStage;
  /** Highest-severity issue found, so the orchestrator can gate reliably. */
  severity?: ReviewSeverity;
  createdAt: string;
}

/**
 * A durable note one role records on the workstream blackboard so later roles
 * read it instead of re-investigating: a root cause, a key file/symbol, the
 * test command, a dead end, etc.
 */
export interface Finding {
  id: string;
  workstreamId: string;
  role: string;
  /** The file or area the finding concerns, when applicable. */
  file?: string;
  note: string;
  createdAt: string;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ToolInvocation {
  name: string;
  input: unknown;
  output: string;
  error?: string;
  at: string;
  /** On-disk path when output was spilled to tool-results storage. */
  spillPath?: string;
}

/** Token consumption for a single call, summed across its API requests. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Number of underlying model requests made during the call's tool loop. */
  requests: number;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    requests: 0,
  };
}

export interface RunRecord {
  id: string;
  role: string;
  /** The prompt/task handed to this call. */
  task: string;
  workstreamId?: string;
  taskId?: string;
  parentRunId?: string;
  /** The inbound message that ultimately triggered this call (root of the tree). */
  originMessageId?: string;
  /** Model used for this call (captured for cost attribution). */
  model?: string;
  /** Executor backend that ran this call (e.g. 'cursor-agent'). Absent means LLM. */
  executor?: string;
  /** Quota routing profile (primary or failover target id). */
  routeProfileId?: string;
  /** Quota account that accrued usage for this run. */
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

/** Typed edge between memories (frontmatter `related`). */
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

export type MemoryKind =
  | 'note'
  | 'document'
  | 'preference'
  | 'claim'
  | 'entity';

export const MEMORY_KINDS: readonly MemoryKind[] = [
  'note',
  'document',
  'preference',
  'claim',
  'entity',
] as const;

export const MEMORY_EDGE_TYPES: readonly MemoryEdgeType[] = [
  'related',
  'builds_on',
  'contradicts',
  'cites',
  'categorized_under',
] as const;

export interface Memory {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  /** Short human label. */
  title?: string;
  /** One-line gist used for ranking and listings. */
  summary?: string;
  /** Where this came from: a URL, or "conversation". */
  source?: string;
  kind?: MemoryKind;
  /** Outbound typed links to other memories. */
  related?: MemoryRelation[];
  /** Hash of source bytes / workstream snapshot for freshness / skip-if-unchanged. */
  sourceHash?: string;
  /** Git SHA of the source repo when known. */
  sourceCommit?: string;
  updatedAt?: string;
}
