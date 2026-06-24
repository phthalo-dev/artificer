import path from 'node:path';
import type { ArtificerConfig } from './api/types.js';
import type { DiagnosticsConfig } from './diagnostics/types.js';
import {
  isModelTier,
  type ModelTier,
  type ModelTiers,
} from './engine/models.js';
import {
  cloneRoleTiers,
  DEFAULT_PRESET_ID,
  getPreset,
} from './engine/presets.js';
import type { RoleName } from './storage/types.js';

export interface ToolResultConfig {
  maxCharsPerInvocation: number;
  maxCharsPerRun: number;
}

export interface ContextBorrowingConfig {
  microcompactEnabled: boolean;
  fileCacheMaxEntries: number;
  requireRipgrep: boolean;
  toolResults: ToolResultConfig;
}

export interface RuntimeConfig {
  /** API key for the LLM gateway (an OpenCode Zen key, or a provider key). */
  apiKey: string;
  /** Base URL of the LLM gateway, e.g. https://opencode.ai/zen/v1. */
  baseURL: string;
  /** Default model (the "medium" tier); used as a fallback. */
  model: string;
  /** Concrete model id for each complexity tier. */
  models: ModelTiers;
  /** Which complexity tier each role uses by default. */
  roleTiers: Record<RoleName, ModelTier>;
  /** Which model preset seeded tiers/roleTiers (env MODEL_PRESET). */
  modelPresetId: string;
  /** Root directory where all messages and work history are persisted. */
  dataDir: string;
  /** HTTP port for the runtime server. */
  port: number;
  /** Max concurrent in-flight LLM calls across all workstreams. */
  concurrency: number;
  /** Max tool-use iterations allowed within a single call before forcing a stop. */
  maxIterationsPerCall: number;
  /** Tighter iteration cap for the planner, to force a decisive write_plan. */
  maxPlannerIterations: number;
  /** Hard wall-clock cap (ms) for a single call, aborting in-flight generation. */
  maxRunMs: number;
  /** Safety cap on total LLM calls per workstream to prevent runaway loops. */
  maxRunsPerWorkstream: number;
  /** Whether to re-invoke the orchestrator for workstreams interrupted by a restart. */
  resumeOnStartup: boolean;
  /** Human-facing name of this agent entity. */
  agentName: string;
  /**
   * The agent's own GitHub credentials. When set, git/gh/run_shell commands
   * authenticate as this account (separate from the user's). Undefined when no
   * token is configured, in which case tools fall back to ambient credentials.
   */
  github?: GitHubConfig;
  /**
   * Post-edit diagnostics: after edit_file/write_file, run the relevant
   * language checker and feed errors back to the model. Consumers can extend
   * `providers` with their own languages/frameworks.
   */
  diagnostics: DiagnosticsConfig;
  /** Context-economics settings (tool spill, microcompact, file cache, search). */
  contextBorrowing: ContextBorrowingConfig;
  /** Root directory of the agent identity repo (config, tools, memories). */
  identityDir: string;
  /** Bearer token for API authentication. Absent = no auth (local dev). */
  apiAuthKey?: string;
}

/** The agent's GitHub identity, used to clone, push, and open/comment on PRs. */
export interface GitHubConfig {
  /** Personal access token used for git HTTPS auth and the `gh` CLI. */
  token: string;
  /** Commit author/committer name (the agent account's name). */
  userName?: string;
  /** Commit author/committer email (recommend the account's noreply email). */
  userEmail?: string;
  /**
   * Interval (ms) for polling the agent's own PRs and notifications. Absent
   * or 0 disables the watcher (default — no background GitHub activity).
   */
  watchIntervalMs?: number;
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const dataDir = env.ARTIFICER_DATA_DIR
    ? path.resolve(env.ARTIFICER_DATA_DIR)
    : path.resolve(process.cwd(), 'data');

  const presetId = env.MODEL_PRESET ?? DEFAULT_PRESET_ID;
  const preset = getPreset(presetId) ?? getPreset(DEFAULT_PRESET_ID)!;

  // Preset provides defaults; explicit LLM_MODEL* env vars override individual tiers.
  const models: ModelTiers = {
    low:
      env.LLM_MODEL_LOW ||
      env.ANTHROPIC_MODEL_LOW ||
      preset.tiers.low,
    medium:
      env.LLM_MODEL || env.ANTHROPIC_MODEL || preset.tiers.medium,
    high:
      env.LLM_MODEL_HIGH ||
      env.ANTHROPIC_MODEL_HIGH ||
      preset.tiers.high,
  };

  const roleTiers = cloneRoleTiers(preset.roleTiers);
  for (const role of Object.keys(roleTiers) as RoleName[]) {
    const override = env[`RUNTIME_TIER_${role.toUpperCase()}`];
    if (isModelTier(override)) roleTiers[role] = override;
  }

  const hasTierOverride = Boolean(
    env.LLM_MODEL_LOW ||
      env.LLM_MODEL ||
      env.LLM_MODEL_HIGH ||
      env.ANTHROPIC_MODEL_LOW ||
      env.ANTHROPIC_MODEL ||
      env.ANTHROPIC_MODEL_HIGH,
  );
  const hasRoleOverride = (Object.keys(roleTiers) as RoleName[]).some(
    (role) => env[`RUNTIME_TIER_${role.toUpperCase()}`],
  );
  const modelPresetId =
    hasTierOverride || hasRoleOverride ? 'custom' : preset.id;

  const apiKey =
    env.LLM_API_KEY || env.ZEN_API_KEY || env.ANTHROPIC_API_KEY;

  const diagnostics: DiagnosticsConfig = {
    enabled: env.RUNTIME_DIAGNOSTICS !== 'false',
    timeoutMs: env.RUNTIME_DIAGNOSTICS_TIMEOUT_MS
      ? Number(env.RUNTIME_DIAGNOSTICS_TIMEOUT_MS)
      : 20_000,
    maxPerFile: env.RUNTIME_DIAGNOSTICS_MAX_PER_FILE
      ? Number(env.RUNTIME_DIAGNOSTICS_MAX_PER_FILE)
      : 20,
    typescript: env.RUNTIME_DIAGNOSTICS_TYPESCRIPT !== 'false',
  };

  const githubToken = env.GITHUB_TOKEN || env.GH_TOKEN;
  const github: GitHubConfig | undefined = githubToken
    ? {
        token: githubToken,
        userName: env.GITHUB_USER_NAME,
        userEmail: env.GITHUB_USER_EMAIL,
        watchIntervalMs: env.GITHUB_WATCH_INTERVAL_MS
          ? Number(env.GITHUB_WATCH_INTERVAL_MS)
          : undefined,
      }
    : undefined;

  const contextBorrowing: ContextBorrowingConfig = {
    microcompactEnabled: env.RUNTIME_MICROCOMPACT_ENABLED !== 'false',
    fileCacheMaxEntries: env.RUNTIME_FILE_CACHE_MAX_ENTRIES
      ? Number(env.RUNTIME_FILE_CACHE_MAX_ENTRIES)
      : 64,
    requireRipgrep: env.RUNTIME_REQUIRE_RG !== 'false',
    toolResults: {
      maxCharsPerInvocation: env.RUNTIME_TOOL_RESULT_MAX_CHARS
        ? Number(env.RUNTIME_TOOL_RESULT_MAX_CHARS)
        : 12_000,
      maxCharsPerRun: env.RUNTIME_TOOL_RESULT_MAX_PER_RUN_CHARS
        ? Number(env.RUNTIME_TOOL_RESULT_MAX_PER_RUN_CHARS)
        : 80_000,
    },
  };

  const identityDir = env.ARTIFICER_IDENTITY_DIR
    ? path.resolve(env.ARTIFICER_IDENTITY_DIR)
    : path.resolve(process.cwd());

  return {
    apiKey: required('LLM_API_KEY (or ZEN_API_KEY / ANTHROPIC_API_KEY)', apiKey),
    baseURL: env.LLM_BASE_URL || 'https://opencode.ai/zen/v1',
    model: models.medium,
    models,
    roleTiers,
    modelPresetId,
    dataDir,
    port: env.PORT ? Number(env.PORT) : 4100,
    concurrency: env.RUNTIME_CONCURRENCY ? Number(env.RUNTIME_CONCURRENCY) : 2,
    maxIterationsPerCall: env.RUNTIME_MAX_ITERATIONS
      ? Number(env.RUNTIME_MAX_ITERATIONS)
      : 24,
    maxPlannerIterations: env.RUNTIME_MAX_PLANNER_ITERATIONS
      ? Number(env.RUNTIME_MAX_PLANNER_ITERATIONS)
      : 18,
    maxRunMs: env.RUNTIME_MAX_RUN_MS ? Number(env.RUNTIME_MAX_RUN_MS) : 420_000,
    maxRunsPerWorkstream: env.RUNTIME_MAX_RUNS_PER_WORKSTREAM
      ? Number(env.RUNTIME_MAX_RUNS_PER_WORKSTREAM)
      : 60,
    resumeOnStartup: env.RUNTIME_RESUME_ON_STARTUP !== 'false',
    agentName: env.AGENT_NAME || 'Artificer',
    github,
    diagnostics,
    contextBorrowing,
    identityDir,
    apiAuthKey: env.ARTIFICER_API_KEY || undefined,
  };
}

function parseInterval(s: string): number | undefined {
  const m = s.match(/^(\d+)(ms|s|m|h)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'ms': return n;
    case 's': return n * 1000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    default: return undefined;
  }
}

export function mergeWithDefinition(
  definition: ArtificerConfig,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const base = loadConfig(env);

  return {
    ...base,
    agentName: env.AGENT_NAME ?? definition.name ?? base.agentName,
    models: {
      low: env.LLM_MODEL_LOW ?? definition.models?.low ?? base.models.low,
      medium: env.LLM_MODEL ?? definition.models?.medium ?? base.models.medium,
      high: env.LLM_MODEL_HIGH ?? definition.models?.high ?? base.models.high,
    },
    roleTiers: {
      ...base.roleTiers,
      ...definition.roleTiers,
    },
    concurrency: env.RUNTIME_CONCURRENCY
      ? Number(env.RUNTIME_CONCURRENCY)
      : definition.concurrency ?? base.concurrency,
    maxIterationsPerCall: env.RUNTIME_MAX_ITERATIONS
      ? Number(env.RUNTIME_MAX_ITERATIONS)
      : definition.maxIterationsPerCall ?? base.maxIterationsPerCall,
    port: env.PORT ? Number(env.PORT) : definition.port ?? base.port,
    github: base.github
      ? {
          ...base.github,
          watchIntervalMs: base.github.watchIntervalMs ??
            (definition.github?.watchInterval
              ? parseInterval(definition.github.watchInterval)
              : undefined),
        }
      : undefined,
  };
}
