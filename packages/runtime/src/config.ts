import path from 'node:path';
import {
  DEFAULT_ROLE_TIER,
  isModelTier,
  type ModelTier,
  type ModelTiers,
} from './engine/models.js';
import type { RoleName } from './storage/types.js';

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
  /** Root directory where all messages and work history are persisted. */
  dataDir: string;
  /** HTTP port for the runtime server. */
  port: number;
  /** Max concurrent in-flight LLM calls across all workstreams. */
  concurrency: number;
  /** Max tool-use iterations allowed within a single call before forcing a stop. */
  maxIterationsPerCall: number;
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

  // Tier model ids accept any Zen model id (LLM_MODEL* preferred; the legacy
  // ANTHROPIC_MODEL* names still work for back-compat).
  const models: ModelTiers = {
    low: env.LLM_MODEL_LOW || env.ANTHROPIC_MODEL_LOW || 'claude-haiku-4-5',
    medium: env.LLM_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    high: env.LLM_MODEL_HIGH || env.ANTHROPIC_MODEL_HIGH || 'claude-opus-4-8',
  };

  // Per-role tier overrides, e.g. RUNTIME_TIER_WORKER=medium.
  const roleTiers = { ...DEFAULT_ROLE_TIER };
  for (const role of Object.keys(roleTiers) as RoleName[]) {
    const override = env[`RUNTIME_TIER_${role.toUpperCase()}`];
    if (isModelTier(override)) roleTiers[role] = override;
  }

  const apiKey =
    env.LLM_API_KEY || env.ZEN_API_KEY || env.ANTHROPIC_API_KEY;

  const githubToken = env.GITHUB_TOKEN || env.GH_TOKEN;
  const github: GitHubConfig | undefined = githubToken
    ? {
        token: githubToken,
        userName: env.GITHUB_USER_NAME,
        userEmail: env.GITHUB_USER_EMAIL,
      }
    : undefined;

  return {
    apiKey: required('LLM_API_KEY (or ZEN_API_KEY / ANTHROPIC_API_KEY)', apiKey),
    baseURL: env.LLM_BASE_URL || 'https://opencode.ai/zen/v1',
    model: models.medium,
    models,
    roleTiers,
    dataDir,
    port: env.PORT ? Number(env.PORT) : 4100,
    concurrency: env.RUNTIME_CONCURRENCY ? Number(env.RUNTIME_CONCURRENCY) : 2,
    maxIterationsPerCall: env.RUNTIME_MAX_ITERATIONS
      ? Number(env.RUNTIME_MAX_ITERATIONS)
      : 24,
    maxRunsPerWorkstream: env.RUNTIME_MAX_RUNS_PER_WORKSTREAM
      ? Number(env.RUNTIME_MAX_RUNS_PER_WORKSTREAM)
      : 60,
    resumeOnStartup: env.RUNTIME_RESUME_ON_STARTUP !== 'false',
    agentName: env.AGENT_NAME || 'Artificer',
    github,
  };
}
