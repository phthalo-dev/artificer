import type { RoleName } from '../storage/types.js';

/** Complexity tier for a call, mapped to a concrete model id. */
export type ModelTier = 'low' | 'medium' | 'high';

export const MODEL_TIERS: ModelTier[] = ['low', 'medium', 'high'];

/** Concrete model id for each tier. */
export interface ModelTiers {
  low: string;
  medium: string;
  high: string;
}

/**
 * Default complexity per role — async-economy profile: cheap coordination and
 * review, medium-tier workers, high reserved for orchestrator escalation.
 */
export const DEFAULT_ROLE_TIER: Record<RoleName, ModelTier> = {
  communicator: 'low',
  orchestrator: 'low',
  planner: 'medium',
  reviewer: 'low',
  worker: 'medium',
  librarian: 'low',
  receipt: 'low',
};

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && (MODEL_TIERS as string[]).includes(value);
}

/**
 * Choose the model for a call. An explicit `override` (e.g. the orchestrator
 * judging a task's complexity) wins; otherwise the role's default tier applies.
 */
export function pickModel(
  tiers: ModelTiers,
  roleTiers: Record<RoleName, ModelTier>,
  role: RoleName,
  override?: ModelTier,
): string {
  const tier = override ?? roleTiers[role];
  return tiers[tier];
}
