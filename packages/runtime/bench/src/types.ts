/**
 * Shared types for the benchmarking harness. These are intentionally
 * self-contained (no imports from the runtime's src) so the harness stays
 * decoupled and can be reasoned about as a pure HTTP client.
 */

/** Token usage shape mirrored from the runtime's /usage and /cost responses. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requests: number;
}

/** Aggregated usage plus derived cost, as returned by the runtime. */
export interface UsageSummary extends TokenUsage {
  runs: number;
  costUsd: number;
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

export type SuiteKind = 'swebench' | 'deepswe';

/** Unified task row for SWE-bench and DeepSWE suites. */
export interface BenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  suite: SuiteKind;
  /** DeepSWE: primary language (typescript, go, rust, …). */
  language?: string;
  /** DeepSWE: full clone URL from task.toml. */
  repository_url?: string;
  /** DeepSWE: prebuilt verifier image. */
  docker_image?: string;
  display_title?: string;
  /** SWE-bench evaluator fields (optional for DeepSWE). */
  FAIL_TO_PASS?: string;
  PASS_TO_PASS?: string;
  version?: string;
  environment_setup_commit?: string;
}

/** @deprecated Alias kept for internal references during migration. */
export type SweBenchInstance = BenchInstance;

/** The curated suite definition stored in bench/tasks/*.json. */
export interface SuiteDefinition {
  /** Suite loader: SWE-bench (HF dataset) or DeepSWE (Harbor tasks). */
  kind?: SuiteKind;
  /** Human-readable label for the UI. */
  name?: string;
  description?: string;
  /** HuggingFace dataset name (SWE-bench only). */
  dataset?: string;
  /** Dataset split (SWE-bench only). */
  split?: string;
  /** Optional dataset config name (SWE-bench only). */
  config?: string;
  /** Task / instance ids to run. */
  instanceIds: string[];
}

/** A SWE-bench prediction line (one per instance) for the evaluator. */
export interface Prediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

/** Terminal outcome the driver records for one instance attempt. */
export type AttemptOutcome =
  | 'submitted'
  | 'empty_patch'
  | 'blocked'
  | 'timeout'
  | 'failed'
  | 'error';

/** Per-instance record the driver writes to results/attempts.json. */
export interface AttemptRecord {
  instanceId: string;
  repo: string;
  baseCommit: string;
  outcome: AttemptOutcome;
  messageId?: string;
  workstreamId?: string;
  workstreamStatus?: WorkstreamStatus;
  durationMs: number;
  patchBytes: number;
  usage?: UsageSummary;
  byRole?: Record<string, UsageSummary>;
  error?: string;
  /** Communicator learn() invocations during this attempt. */
  learnCallCount?: number;
  /** Whether a git repo was present in the workspace at end. */
  localRepoReady?: boolean;
  /** Relative path to the git repo inside the workspace, if found. */
  cloneLocation?: string;
  /** Ms until preflight clone or first in-workspace git clone. */
  setupPhaseMs?: number;
  /** Ms until first edit_file / write_file / shell file write. */
  firstEditMs?: number;
}
