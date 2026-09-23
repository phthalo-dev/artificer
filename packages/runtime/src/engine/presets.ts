import type { RoleName } from '../storage/types.js';
import type { ModelTier, ModelTiers } from './models.js';

export interface ModelPreset {
  id: string;
  name: string;
  description: string;
  tiers: ModelTiers;
  roleTiers: Record<RoleName, ModelTier>;
}

const ROLES: RoleName[] = [
  'communicator',
  'orchestrator',
  'planner',
  'reviewer',
  'worker',
  'librarian',
  'receipt',
];

/** Cost-first async defaults: cheap coordination, medium workers, high for escalation only. */
const ASYNC_ECONOMY_ROLES: Record<RoleName, ModelTier> = {
  communicator: 'low',
  orchestrator: 'low',
  planner: 'medium',
  reviewer: 'low',
  worker: 'medium',
  librarian: 'low',
  receipt: 'low',
};

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'async-economy',
    name: 'Async economy',
    description:
      'Default cost-first profile. Cheap orchestration and review; gpt-5.4-mini does the work; gpt-5.4 for escalation.',
    tiers: {
      low: 'gpt-5-nano',
      medium: 'gpt-5.4-mini',
      high: 'gpt-5.4',
    },
    roleTiers: ASYNC_ECONOMY_ROLES,
  },
  {
    id: 'ultra-budget',
    name: 'Ultra budget',
    description:
      'Minimum spend. Codex-mini workers, nano routing, mini-tier escalation only.',
    tiers: {
      low: 'gpt-5-nano',
      medium: 'gpt-5.1-codex-mini',
      high: 'gpt-5.4-mini',
    },
    roleTiers: ASYNC_ECONOMY_ROLES,
  },
  {
    id: 'async-slow',
    name: 'Async slow',
    description:
      'Same role map as async economy but kimi-k2.6 as the workhorse — slower, still cheap on DeepSWE.',
    tiers: {
      low: 'gpt-5-nano',
      medium: 'kimi-k2.6',
      high: 'gpt-5.4-mini',
    },
    roleTiers: ASYNC_ECONOMY_ROLES,
  },
  {
    id: 'quality-first',
    name: 'Quality first',
    description:
      'Latency/quality profile. Haiku comms, Sonnet coordination, Opus for planning and coding.',
    tiers: {
      low: 'claude-haiku-4-5',
      medium: 'claude-sonnet-4-6',
      high: 'claude-opus-4-8',
    },
    roleTiers: {
      communicator: 'low',
      orchestrator: 'medium',
      planner: 'high',
      reviewer: 'medium',
      worker: 'high',
      librarian: 'medium',
      receipt: 'low',
    },
  },
  {
    id: 'bench-budget',
    name: 'Bench budget',
    description:
      'Previous bench experiment stack (nano / gemini-3-flash / gpt-5.4-mini) for A/B comparison.',
    tiers: {
      low: 'gpt-5-nano',
      medium: 'gemini-3-flash',
      high: 'gpt-5.4-mini',
    },
    roleTiers: {
      communicator: 'low',
      orchestrator: 'medium',
      planner: 'high',
      reviewer: 'medium',
      worker: 'high',
      librarian: 'medium',
      receipt: 'low',
    },
  },
  // --- OpenCode Go (LLM_BASE_URL=https://opencode.ai/zen/go/v1) ---
  {
    id: 'go-economy',
    name: 'Go economy',
    description:
      'Recommended Go profile: flash routing, kimi-k2.6 workers, deepseek-v4-pro escalation. Best async value/correctness ratio on the Go subscription.',
    tiers: {
      low: 'deepseek-v4-flash',
      medium: 'kimi-k2.6',
      high: 'deepseek-v4-pro',
    },
    roleTiers: {
      ...ASYNC_ECONOMY_ROLES,
      orchestrator: 'medium',
      reviewer: 'medium',
    },
  },
  {
    id: 'go-flash',
    name: 'Go flash',
    description:
      'Cheapest Go stack for high-volume bench iteration. DeepSeek V4 Flash everywhere except escalation.',
    tiers: {
      low: 'deepseek-v4-flash',
      medium: 'deepseek-v4-flash',
      high: 'deepseek-v4-pro',
    },
    roleTiers: ASYNC_ECONOMY_ROLES,
  },
  {
    id: 'go-mimo',
    name: 'Go MiMo',
    description:
      'Volume-first Go profile. MiMo-V2.5 for bulk async work; MiMo-V2.5-Pro for hard steps.',
    tiers: {
      low: 'mimo-v2.5',
      medium: 'mimo-v2.5',
      high: 'mimo-v2.5-pro',
    },
    roleTiers: ASYNC_ECONOMY_ROLES,
  },
  {
    id: 'go-quality',
    name: 'Go quality',
    description:
      'Strongest open models on Go while keeping async-economy role map. GLM-5.1 escalation; flash still routes cheap roles.',
    tiers: {
      low: 'deepseek-v4-flash',
      medium: 'kimi-k2.6',
      high: 'glm-5.1',
    },
    roleTiers: ASYNC_ECONOMY_ROLES,
  },
  {
    id: 'go-minimax',
    name: 'Go MiniMax',
    description:
      'MiniMax M-series on Go (Anthropic Messages API). M2.5 routing, M2.7 workers, M3 escalation.',
    tiers: {
      low: 'minimax-m2.5',
      medium: 'minimax-m2.7',
      high: 'minimax-m3',
    },
    roleTiers: ASYNC_ECONOMY_ROLES,
  },
  {
    id: 'open-weights-economy',
    name: 'Open weights economy',
    description:
      'Zen-hosted open-weight stack: North Mini Code and Laguna S free tiers for bulk work, Kimi K3 for escalation. Requires LLM_BASE_URL=https://opencode.ai/zen/v1.',
    tiers: {
      low: 'north-mini-code-free',
      medium: 'laguna-s-2.1-free',
      high: 'kimi-k3',
    },
    roleTiers: {
      ...ASYNC_ECONOMY_ROLES,
      reviewer: 'medium',
    },
  },
  {
    id: 'baseten-open-weights',
    name: 'Baseten open weights',
    description:
      'Baseten Model APIs: Inkling Small workers, Inkling coordination, Kimi K3 escalation. Requires LLM_BASE_URL=https://inference.baseten.co/v1 and BASETEN_API_KEY.',
    tiers: {
      low: 'thinkingmachines/inkling-small',
      medium: 'thinkingmachines/inkling',
      high: 'moonshotai/Kimi-K3',
    },
    roleTiers: {
      ...ASYNC_ECONOMY_ROLES,
      orchestrator: 'medium',
      reviewer: 'medium',
    },
  },
];

export const DEFAULT_PRESET_ID = 'async-economy';

const BY_ID = Object.fromEntries(MODEL_PRESETS.map((p) => [p.id, p])) as Record<
  string,
  ModelPreset
>;

export function getPreset(id: string): ModelPreset | undefined {
  return BY_ID[id];
}

export function listPresets(): ModelPreset[] {
  return MODEL_PRESETS;
}

export function isPresetId(id: string): boolean {
  return id in BY_ID;
}

/** Shallow copy of role tiers so callers can mutate safely. */
export function cloneRoleTiers(
  roleTiers: Record<RoleName, ModelTier>,
): Record<RoleName, ModelTier> {
  return Object.fromEntries(
    ROLES.map((role) => [role, roleTiers[role]]),
  ) as Record<RoleName, ModelTier>;
}
