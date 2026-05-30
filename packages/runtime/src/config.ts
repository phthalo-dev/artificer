import path from 'node:path';
import {
  DEFAULT_ROLE_TIER,
  isModelTier,
  type ModelTier,
  type ModelTiers,
} from './engine/models.js';
import type { RoleName } from './storage/types.js';

export interface RuntimeConfig {
  /** Anthropic API key the agent uses as its own identity. */
  anthropicApiKey: string;
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

  const models: ModelTiers = {
    low: env.ANTHROPIC_MODEL_LOW || 'claude-haiku-4-5-20251001',
    medium: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    high: env.ANTHROPIC_MODEL_HIGH || 'claude-opus-4-8',
  };

  // Per-role tier overrides, e.g. RUNTIME_TIER_WORKER=medium.
  const roleTiers = { ...DEFAULT_ROLE_TIER };
  for (const role of Object.keys(roleTiers) as RoleName[]) {
    const override = env[`RUNTIME_TIER_${role.toUpperCase()}`];
    if (isModelTier(override)) roleTiers[role] = override;
  }

  return {
    anthropicApiKey: required('ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY),
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
  };
}
