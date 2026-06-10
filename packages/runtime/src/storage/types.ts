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
  | 'blocked'
  | 'done'
  | 'failed'
  | 'cancelled';

export type WorkstreamPhase =
  | 'setup'
  | 'planning'
  | 'implementing'
  | 'verifying'
  | 'done';

export interface PhaseAgentDefinition {
  id: string;
  role: 'planner' | 'worker' | 'reviewer';
  agentConfigId: string;
}

export interface PhaseConfig {
  phase: WorkstreamPhase;
  maxIterations: number;
  iterationsInPhase: number;
  startedAt: string;
  agentsPlanned?: boolean;
  agentDefinitions?: PhaseAgentDefinition[];
  /** Agent configs defined for this phase (persisted for restart resilience). */
  agentConfigs?: Record<string, StoredAgentConfig>;
}

/** Serializable agent configuration stored on a workstream phase. */
export interface StoredAgentConfig {
  id: string;
  name: string;
  archetype: string;
  toolOverrides?: { add?: string[]; remove?: string[] };
  modelTier: 'low' | 'medium' | 'high';
  modelOverride?: string;
  skills?: string[];
  promptExtension?: string;
  maxTurns?: number;
  contextDirectives?: string;
}

/** LLM-generated cross-call history summary (agentic compaction). */
export interface CompactionArtifact {
  summary: string;
  updatedAt: string;
  /** Last run id included in the compaction (older history lives in summary). */
  compactedThroughRunId?: string;
  generation: number;
  tier?: 'soft' | 'hard';
  estimatedCharsBefore?: number;
}

export interface Workstream {
  id: string;
  title: string;
  /** The original request / objective driving this workstream. */
  goal: string;
  status: WorkstreamStatus;
  /** Running summary the orchestrator maintains across calls. */
  summary: string;
  /** Optional repository this workstream operates on. */
  repoUrl?: string;
  /** Optional base commit to check out after cloning (bench / SWE tasks). */
  baseCommit?: string;
  /** Current phase of the workstream lifecycle. */
  currentPhase: WorkstreamPhase;
  /** Configuration for the current phase. */
  phaseConfig?: PhaseConfig;
  /** History of completed phases. */
  phaseHistory: PhaseConfig[];
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
  role: RoleName;
  /** The prompt/task handed to this call. */
  task: string;
  workstreamId?: string;
  taskId?: string;
  parentRunId?: string;
  /** The inbound message that ultimately triggered this call (root of the tree). */
  originMessageId?: string;
  /** Model used for this call (captured for cost attribution). */
  model?: string;
  status: RunStatus;
  toolCalls: ToolInvocation[];
  usage: TokenUsage;
  output?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Dynamic agent configuration (Phase 2). */
  agentConfigId?: string;
}

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
  kind?: 'note' | 'document';
  updatedAt?: string;
}
