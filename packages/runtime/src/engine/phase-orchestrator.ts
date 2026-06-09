import type { WorkstreamPhase } from '../storage/types.js';
import { isRepoTaskMessage } from './task-intent.js';

/**
 * Whether entering `nextPhase` should invoke the orchestrator to define phase
 * agents. Planning is always mechanical (one planner + write_plan); only
 * implementing benefits from custom agent definitions.
 */
export function shouldInvokePhaseOrchestrator(
  goal: string,
  nextPhase: WorkstreamPhase,
): boolean {
  if (nextPhase !== 'implementing') return false;

  const lower = goal.toLowerCase();
  if (lower.includes('architect') || lower.includes('design')) return true;

  // Repo / SWE-bench tasks have long goals but still benefit from specialized
  // worker/reviewer agents during implementation.
  if (isRepoTaskMessage(goal)) return true;

  return goal.length > 500;
}
