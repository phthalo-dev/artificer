/**
 * Catalog of OpenCode Zen and Go models. Maps each model id to the AI SDK
 * provider package that serves it, plus published pricing.
 * See https://opencode.ai/docs/zen and https://opencode.ai/docs/go.
 *
 * Zen (`/zen/v1`) and Go (`/zen/go/v1`) expose four API shapes under one base URL:
 *  - `@ai-sdk/anthropic`          -> `/messages`         (Claude*, Qwen*)
 *  - `@ai-sdk/openai` (Responses) -> `/responses`        (GPT*)
 *  - `@ai-sdk/google`             -> `/models/...`       (Gemini*)
 *  - `@ai-sdk/openai-compatible`  -> `/chat/completions` (GLM, MiniMax, Kimi, ...)
 */

export type LlmSdkPackage =
  | '@ai-sdk/anthropic'
  | '@ai-sdk/openai'
  | '@ai-sdk/google'
  | '@ai-sdk/openai-compatible';

/** USD per million tokens for a model. */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export interface CatalogEntry {
  id: string;
  /** Which AI SDK provider package serves this model on Zen. */
  npm: LlmSdkPackage;
  pricing: ModelPricing;
}

const FREE: ModelPricing = {
  inputPerMTok: 0,
  outputPerMTok: 0,
  cacheWritePerMTok: 0,
  cacheReadPerMTok: 0,
};

function price(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite = 0,
): ModelPricing {
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: cacheRead,
    cacheWritePerMTok: cacheWrite,
  };
}

const ENTRIES: CatalogEntry[] = [
  // --- Anthropic Messages shape: Claude + Qwen ---
  {
    id: 'claude-opus-4-8',
    npm: '@ai-sdk/anthropic',
    pricing: price(5, 25, 0.5, 6.25),
  },
  {
    id: 'claude-opus-4-7',
    npm: '@ai-sdk/anthropic',
    pricing: price(5, 25, 0.5, 6.25),
  },
  {
    id: 'claude-opus-4-6',
    npm: '@ai-sdk/anthropic',
    pricing: price(5, 25, 0.5, 6.25),
  },
  {
    id: 'claude-opus-4-5',
    npm: '@ai-sdk/anthropic',
    pricing: price(5, 25, 0.5, 6.25),
  },
  {
    id: 'claude-opus-4-1',
    npm: '@ai-sdk/anthropic',
    pricing: price(15, 75, 1.5, 18.75),
  },
  {
    id: 'claude-sonnet-4-6',
    npm: '@ai-sdk/anthropic',
    pricing: price(3, 15, 0.3, 3.75),
  },
  {
    id: 'claude-sonnet-4-5',
    npm: '@ai-sdk/anthropic',
    pricing: price(3, 15, 0.3, 3.75),
  },
  {
    id: 'claude-sonnet-4',
    npm: '@ai-sdk/anthropic',
    pricing: price(3, 15, 0.3, 3.75),
  },
  {
    id: 'claude-haiku-4-5',
    npm: '@ai-sdk/anthropic',
    pricing: price(1, 5, 0.1, 1.25),
  },
  {
    id: 'claude-3-5-haiku',
    npm: '@ai-sdk/anthropic',
    pricing: price(0.8, 4, 0.08, 1),
  },
  {
    id: 'qwen3.6-plus',
    npm: '@ai-sdk/anthropic',
    pricing: price(0.5, 3, 0.05, 0.625),
  },
  {
    id: 'qwen3.5-plus',
    npm: '@ai-sdk/anthropic',
    pricing: price(0.2, 1.2, 0.02, 0.25),
  },

  // --- OpenAI Responses shape: GPT ---
  { id: 'gpt-5.5', npm: '@ai-sdk/openai', pricing: price(5, 30, 0.5) },
  { id: 'gpt-5.5-pro', npm: '@ai-sdk/openai', pricing: price(30, 180, 30) },
  { id: 'gpt-5.4', npm: '@ai-sdk/openai', pricing: price(2.5, 15, 0.25) },
  { id: 'gpt-5.4-pro', npm: '@ai-sdk/openai', pricing: price(30, 180, 30) },
  {
    id: 'gpt-5.4-mini',
    npm: '@ai-sdk/openai',
    pricing: price(0.75, 4.5, 0.075),
  },
  {
    id: 'gpt-5.4-nano',
    npm: '@ai-sdk/openai',
    pricing: price(0.2, 1.25, 0.02),
  },
  {
    id: 'gpt-5.3-codex',
    npm: '@ai-sdk/openai',
    pricing: price(1.75, 14, 0.175),
  },
  {
    id: 'gpt-5.3-codex-spark',
    npm: '@ai-sdk/openai',
    pricing: price(1.75, 14, 0.175),
  },
  { id: 'gpt-5.2', npm: '@ai-sdk/openai', pricing: price(1.75, 14, 0.175) },
  {
    id: 'gpt-5.2-codex',
    npm: '@ai-sdk/openai',
    pricing: price(1.75, 14, 0.175),
  },
  { id: 'gpt-5.1', npm: '@ai-sdk/openai', pricing: price(1.07, 8.5, 0.107) },
  {
    id: 'gpt-5.1-codex',
    npm: '@ai-sdk/openai',
    pricing: price(1.07, 8.5, 0.107),
  },
  {
    id: 'gpt-5.1-codex-max',
    npm: '@ai-sdk/openai',
    pricing: price(1.25, 10, 0.125),
  },
  {
    id: 'gpt-5.1-codex-mini',
    npm: '@ai-sdk/openai',
    pricing: price(0.25, 2, 0.025),
  },
  { id: 'gpt-5', npm: '@ai-sdk/openai', pricing: price(1.07, 8.5, 0.107) },
  {
    id: 'gpt-5-codex',
    npm: '@ai-sdk/openai',
    pricing: price(1.07, 8.5, 0.107),
  },
  { id: 'gpt-5-nano', npm: '@ai-sdk/openai', pricing: price(0.05, 0.4, 0.005) },

  // --- Google shape: Gemini ---
  {
    id: 'gemini-3.5-flash',
    npm: '@ai-sdk/google',
    pricing: price(1.5, 9, 0.15),
  },
  { id: 'gemini-3.1-pro', npm: '@ai-sdk/google', pricing: price(2, 12, 0.2) },
  { id: 'gemini-3-flash', npm: '@ai-sdk/google', pricing: price(0.5, 3, 0.05) },

  // --- Anthropic Messages shape on Go: MiniMax, Qwen3.7 ---
  {
    id: 'minimax-m3',
    npm: '@ai-sdk/anthropic',
    pricing: price(0.6, 2.4, 0.12, 0.75),
  },
  {
    id: 'minimax-m2.7',
    npm: '@ai-sdk/anthropic',
    pricing: price(0.3, 1.2, 0.06, 0.375),
  },
  {
    id: 'minimax-m2.5',
    npm: '@ai-sdk/anthropic',
    pricing: price(0.3, 1.2, 0.06, 0.375),
  },
  {
    id: 'qwen3.7-max',
    npm: '@ai-sdk/anthropic',
    pricing: price(2.5, 7.5, 0.5, 3.125),
  },

  // --- OpenAI-compatible chat completions: GLM, Kimi, DeepSeek, MiMo, ... ---
  {
    id: 'glm-5.1',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(1.4, 4.4, 0.26),
  },
  {
    id: 'glm-5',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(1, 3.2, 0.2),
  },
  {
    id: 'kimi-k2.5',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(0.6, 3, 0.1),
  },
  {
    id: 'kimi-k2.6',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(0.95, 4, 0.16),
  },
  {
    id: 'deepseek-v4-pro',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(1.74, 3.48, 0.0145),
  },
  {
    id: 'deepseek-v4-flash',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(0.14, 0.28, 0.0028),
  },
  {
    id: 'mimo-v2.5-pro',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(1.74, 3.48, 0.0145),
  },
  {
    id: 'mimo-v2.5',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(0.14, 0.28, 0.0028),
  },
  {
    id: 'grok-build-0.1',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(1, 2, 0.2),
  },
  { id: 'big-pickle', npm: '@ai-sdk/openai-compatible', pricing: FREE },
  {
    id: 'deepseek-v4-flash-free',
    npm: '@ai-sdk/openai-compatible',
    pricing: FREE,
  },
  { id: 'mimo-v2.5-free', npm: '@ai-sdk/openai-compatible', pricing: FREE },
  {
    id: 'nemotron-3-super-free',
    npm: '@ai-sdk/openai-compatible',
    pricing: FREE,
  },
];

export const MODEL_CATALOG: Record<string, CatalogEntry> = Object.fromEntries(
  ENTRIES.map((entry) => [entry.id, entry]),
);

/**
 * Infer the AI SDK package for a model id not present in the catalog, using the
 * same id-prefix conventions Zen follows. Lets new Zen models work without a
 * catalog bump (pricing falls back to family-based estimates).
 */
export function inferPackage(modelId: string): LlmSdkPackage {
  const id = modelId.toLowerCase();
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')) {
    return '@ai-sdk/openai';
  }
  if (
    id.startsWith('claude-') ||
    id.startsWith('qwen') ||
    id.startsWith('minimax-')
  ) {
    return '@ai-sdk/anthropic';
  }
  if (id.startsWith('gemini')) {
    return '@ai-sdk/google';
  }
  return '@ai-sdk/openai-compatible';
}

/** The AI SDK package that serves a model id on Zen. */
export function packageForModel(modelId: string): LlmSdkPackage {
  return MODEL_CATALOG[modelId]?.npm ?? inferPackage(modelId);
}

/** Exact catalog pricing for a model id, or undefined if unknown. */
export function catalogPricing(modelId: string): ModelPricing | undefined {
  return MODEL_CATALOG[modelId]?.pricing;
}
