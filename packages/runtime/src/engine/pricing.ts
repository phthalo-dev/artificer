import { catalogPricing, type ModelPricing } from '../llm/catalog.js';
import type { TokenUsage } from '../storage/types.js';

export type { ModelPricing } from '../llm/catalog.js';

/**
 * Best-effort pricing by model family, used only when a model id is not present
 * in the Zen catalog. These are ESTIMATES based on Anthropic-style per-tier
 * rates (cache writes ~1.25x input, cache reads ~0.1x input).
 */
const TIERS: Array<{ match: RegExp; pricing: ModelPricing }> = [
  {
    match: /opus/i,
    pricing: {
      inputPerMTok: 15,
      outputPerMTok: 75,
      cacheWritePerMTok: 18.75,
      cacheReadPerMTok: 1.5,
    },
  },
  {
    match: /haiku/i,
    pricing: {
      inputPerMTok: 0.8,
      outputPerMTok: 4,
      cacheWritePerMTok: 1,
      cacheReadPerMTok: 0.08,
    },
  },
  {
    match: /sonnet/i,
    pricing: {
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.3,
    },
  },
];

const FALLBACK: ModelPricing = TIERS[2].pricing;

export function getModelPricing(model: string | undefined): ModelPricing {
  if (!model) return FALLBACK;
  // Exact, published Zen pricing wins.
  const exact = catalogPricing(model);
  if (exact) return exact;
  // Otherwise estimate from the model family.
  for (const tier of TIERS) {
    if (tier.match.test(model)) return tier.pricing;
  }
  return FALLBACK;
}

/** Compute the USD cost of a usage record for a given model. */
export function costForUsage(
  model: string | undefined,
  usage: TokenUsage,
): number {
  const p = getModelPricing(model);
  const cost =
    (usage.inputTokens / 1_000_000) * p.inputPerMTok +
    (usage.outputTokens / 1_000_000) * p.outputPerMTok +
    (usage.cacheCreationInputTokens / 1_000_000) * p.cacheWritePerMTok +
    (usage.cacheReadInputTokens / 1_000_000) * p.cacheReadPerMTok;
  // Round to 6 decimals (micro-dollar precision).
  return Math.round(cost * 1_000_000) / 1_000_000;
}
