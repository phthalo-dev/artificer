import path from 'node:path';
import type { DiagnosticsConfig } from './diagnostics/types.js';
import type { SkillsConfig } from './engine/skills.js';
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
  /** Optional lower iteration cap for planner calls (bench tuning). */
  maxIterationsPlanner?: number;
  /** Wall-clock limit per LLM call; exceeded runs fail so the FSM can retry. */
  maxCallDurationMs: number;
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
  /**
   * Skills composition: load SKILL.md content into agent system prompts when
   * an agent config declares `skills: [...]`. Disabled by default in
   * production; opt in by setting RUNTIME_SKILLS_DIR to a directory of
   * `<name>.md` or `<name>/SKILL.md` files.
   */
  skills: SkillsConfig;
  /** Bench A/B: skip planner/reviewer FSM and run one worker loop. */
  singleLoop: boolean;
}

/** The agent's GitHub identity, used to clone, push, and open/comment on PRs. */
export interface GitHubConfig {
  /** Personal access token used for git HTTPS auth and the `gh` CLI. */
  token: string;
  /** Commit author/committer name (the agent account's name). */
  userName?: string;
  /** Commit author/committer email (recommend the account's noreply email). */
  userEmail?: string;
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

  const baseURL = env.LLM_BASE_URL || 'https://opencode.ai/zen/v1';
  if (modelPresetId.startsWith('go-') && !baseURL.includes('/zen/go/')) {
    throw new Error(
      `MODEL_PRESET=${modelPresetId} requires LLM_BASE_URL=https://opencode.ai/zen/go/v1 ` +
        `(OpenCode Go subscription). Current LLM_BASE_URL: ${baseURL}`,
    );
  }

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

  const skillsDir = env.RUNTIME_SKILLS_DIR
    ? path.resolve(env.RUNTIME_SKILLS_DIR)
    : path.resolve(process.cwd(), 'skills');
  const skills: SkillsConfig = {
    enabled: env.RUNTIME_SKILLS_ENABLED === 'true' && !!env.RUNTIME_SKILLS_DIR,
    dir: skillsDir,
    maxTotalChars: env.RUNTIME_SKILLS_MAX_TOTAL_CHARS
      ? Number(env.RUNTIME_SKILLS_MAX_TOTAL_CHARS)
      : 24_000,
  };

  return {
    apiKey: required('LLM_API_KEY (or ZEN_API_KEY / ANTHROPIC_API_KEY)', apiKey),
    baseURL,
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
    maxIterationsPlanner: env.RUNTIME_MAX_ITERATIONS_PLANNER
      ? Number(env.RUNTIME_MAX_ITERATIONS_PLANNER)
      : undefined,
    maxCallDurationMs: env.RUNTIME_MAX_CALL_DURATION_MS
      ? Number(env.RUNTIME_MAX_CALL_DURATION_MS)
      : 600_000,
    maxRunsPerWorkstream: env.RUNTIME_MAX_RUNS_PER_WORKSTREAM
      ? Number(env.RUNTIME_MAX_RUNS_PER_WORKSTREAM)
      : 60,
    resumeOnStartup: env.RUNTIME_RESUME_ON_STARTUP !== 'false',
    agentName: env.AGENT_NAME || 'Artificer',
    github,
    diagnostics,
    contextBorrowing,
    skills,
    singleLoop: env.RUNTIME_SINGLE_LOOP === 'true',
  };
}
