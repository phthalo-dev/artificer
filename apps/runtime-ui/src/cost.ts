import type { RunRecord, TokenUsage } from './api/types';

// Client-side mirror of packages/runtime/src/engine/pricing.ts so the runs
// table can show per-run cost (the API only exposes cost on aggregate
// summaries, not individual runs).

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

const TIERS: Array<{ match: RegExp; pricing: ModelPricing }> = [
  {
    match: /opus/i,
    pricing: { inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  },
  {
    match: /haiku/i,
    pricing: { inputPerMTok: 0.8, outputPerMTok: 4, cacheWritePerMTok: 1, cacheReadPerMTok: 0.08 },
  },
  {
    match: /sonnet/i,
    pricing: { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  },
];

const FALLBACK = TIERS[2].pricing;

function pricingFor(model: string | undefined): ModelPricing {
  if (!model) return FALLBACK;
  for (const tier of TIERS) if (tier.match.test(model)) return tier.pricing;
  return FALLBACK;
}

export function costForUsage(model: string | undefined, usage: TokenUsage): number {
  const p = pricingFor(model);
  const cost =
    (usage.inputTokens / 1_000_000) * p.inputPerMTok +
    (usage.outputTokens / 1_000_000) * p.outputPerMTok +
    (usage.cacheCreationInputTokens / 1_000_000) * p.cacheWritePerMTok +
    (usage.cacheReadInputTokens / 1_000_000) * p.cacheReadPerMTok;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function costForRun(run: RunRecord): number {
  return costForUsage(run.model, run.usage);
}
