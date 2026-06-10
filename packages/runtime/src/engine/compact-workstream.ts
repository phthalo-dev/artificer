import { generateText, type LanguageModel } from 'ai';
import type { RuntimeConfig } from '../config.js';
import { pickModel } from './models.js';
import type { Store } from '../storage/store.js';
import type { CompactionArtifact } from '../storage/types.js';
import {
  buildFileOpsFromRuns,
  buildSummaryRequest,
  SUMMARIZER_SYSTEM,
  wrapCompactionSummary,
} from './agentic-compact.js';
import {
  assessCompactionTier,
  type CompactionTier,
} from './compaction-config.js';
import { estimateWorkstreamContextChars, runsToCompact } from './compaction-estimate.js';
import {
  pickPruneLevelForBudget,
  serializeRunsForSummary,
} from './progressive-prune.js';

export interface CompactWorkstreamResult {
  compacted: boolean;
  tier: CompactionTier;
  artifact?: CompactionArtifact;
  error?: string;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * After a work-role call, optionally summarize older run history into a durable
 * compaction artifact (soft threshold) with progressive pruning (hard threshold).
 */
export async function maybeCompactWorkstream(opts: {
  store: Store;
  config: RuntimeConfig;
  resolveModel: (modelId: string) => LanguageModel;
  workstreamId: string;
}): Promise<CompactWorkstreamResult> {
  const { store, config, resolveModel, workstreamId } = opts;
  const compactionConfig = config.compaction;

  if (!compactionConfig.enabled) {
    return { compacted: false, tier: 'none' };
  }

  const ws = await store.getWorkstream(workstreamId);
  if (!ws) return { compacted: false, tier: 'none' };

  const runs = await store.listRunsForWorkstream(workstreamId);
  const plan = await store.readPlan(workstreamId);
  const existing = await store.readCompaction(workstreamId);

  const toCompact = runsToCompact(runs, compactionConfig.keepRecentRuns);
  if (toCompact.length < compactionConfig.minRunsBeforeCompact) {
    return { compacted: false, tier: 'none' };
  }

  const estimated = estimateWorkstreamContextChars({
    workstream: ws,
    plan,
    runs,
    compaction: existing,
    keepRecent: compactionConfig.keepRecentRuns,
  });

  const tier = assessCompactionTier(estimated, compactionConfig);
  if (tier === 'none') {
    return { compacted: false, tier: 'none' };
  }

  const pruneLevel =
    tier === 'hard'
      ? pickPruneLevelForBudget(toCompact, compactionConfig.maxSummaryInputChars)
      : 0;

  const runsText = serializeRunsForSummary(toCompact, pruneLevel);
  const planExcerpt = plan ? clip(plan, 6_000) : null;
  const fileOpsLedger = buildFileOpsFromRuns(toCompact);

  const userMessage = buildSummaryRequest({
    workstream: ws,
    planExcerpt,
    runsText: clip(runsText, compactionConfig.maxSummaryInputChars),
    priorSummary: existing?.summary ?? null,
    fileOpsLedger,
  });

  const modelId = pickModel(config.models, config.roleTiers, 'librarian', 'low');

  try {
    const result = await generateText({
      model: resolveModel(modelId),
      system: SUMMARIZER_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
      maxOutputTokens: compactionConfig.summaryMaxTokens,
    });

    const summary = wrapCompactionSummary(result.text.trim());
    const compactedThroughRunId = toCompact.at(-1)?.id;
    const artifact: CompactionArtifact = {
      summary,
      updatedAt: new Date().toISOString(),
      compactedThroughRunId,
      generation: (existing?.generation ?? 0) + 1,
      tier,
      estimatedCharsBefore: estimated,
    };

    await store.writeCompaction(workstreamId, artifact);
    return { compacted: true, tier, artifact };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { compacted: false, tier, error: message };
  }
}
