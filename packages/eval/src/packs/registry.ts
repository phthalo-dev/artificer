import {
  SWE_BENCH_LITE_30,
  SWE_BENCH_LITE_30_PACK_ID,
} from './swebench-lite-30.js';

export type EvalPackKind = 'swebench';

export interface EvalPackDefinition {
  id: string;
  name: string;
  description: string;
  kind: EvalPackKind;
  dataset: string;
  split: string;
  config: string;
  instanceIds: readonly string[];
}

const PACKS: Record<string, EvalPackDefinition> = {
  [SWE_BENCH_LITE_30_PACK_ID]: SWE_BENCH_LITE_30,
};

export function listEvalPacks(): EvalPackDefinition[] {
  return Object.values(PACKS);
}

export function getEvalPack(packId: string): EvalPackDefinition {
  const pack = PACKS[packId];
  if (!pack) {
    const known = listEvalPacks()
      .map((entry) => entry.id)
      .join(', ');
    throw new Error(
      `Unknown eval pack: ${packId}. Available packs: ${known || '(none)'}`,
    );
  }
  return pack;
}
