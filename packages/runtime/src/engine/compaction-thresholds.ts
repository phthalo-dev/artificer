/**
 * Model-family compaction profiles for prior-run digest size.
 *
 * Letta's summarizer triggers earlier for GPT-5-class models (they degrade
 * near the context ceiling). Artificer's analog is how many prior runs we
 * inject into the next call — not a token-window percentage, because
 * microcompaction already lives in the digest, not an in-loop summarizer.
 */

export type CompactionProfileName = 'aggressive' | 'default' | 'generous';

export interface CompactionProfile {
  name: CompactionProfileName;
  /** How many prior completed runs to include in the digest. */
  priorRunsToInclude: number;
  /** When true, compactable tool outputs should be summarized. */
  microcompactAggressive: boolean;
}

/**
 * Default keeps the historical 8-run window used when microcompact is on.
 * GPT-5-class models compact earlier (1 run). Long-context Gemini keeps more
 * history (12) because the extra window is cheap.
 */
export const COMPACTION_PROFILES: Record<
  CompactionProfileName,
  CompactionProfile
> = {
  aggressive: {
    name: 'aggressive',
    priorRunsToInclude: 1,
    microcompactAggressive: true,
  },
  default: {
    name: 'default',
    priorRunsToInclude: 8,
    microcompactAggressive: false,
  },
  generous: {
    name: 'generous',
    priorRunsToInclude: 12,
    microcompactAggressive: false,
  },
};

/** Matches GPT-5 names in raw or provider-prefixed form (Letta's family regex). */
const GPT5_MODEL_FAMILY_RE = /(^|\/)gpt-5($|[.-])/i;
const GEMINI_MODEL_FAMILY_RE = /(^|\/)gemini/i;

export function parseCompactionProfileName(
  value: string | undefined,
): CompactionProfileName | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === '') return undefined;
  if (normalized === 'aggressive') return 'aggressive';
  if (normalized === 'default') return 'default';
  if (normalized === 'generous') return 'generous';
  return undefined;
}

export function compactionProfileForModel(
  modelId: string,
  override?: CompactionProfileName,
): CompactionProfile {
  if (override) return COMPACTION_PROFILES[override];
  const id = modelId.trim();
  if (!id) return COMPACTION_PROFILES.default;
  if (GPT5_MODEL_FAMILY_RE.test(id)) return COMPACTION_PROFILES.aggressive;
  if (GEMINI_MODEL_FAMILY_RE.test(id)) return COMPACTION_PROFILES.generous;
  return COMPACTION_PROFILES.default;
}
