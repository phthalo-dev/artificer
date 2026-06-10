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

  // Short repo tasks use default archetypes; only invoke for complex repo work.
  if (isRepoTaskMessage(goal)) {
    if (goal.length > 1_200) return true;
    const lower = goal.toLowerCase();
    if (
      lower.includes('multi-file') ||
      lower.includes('multiple files') ||
      lower.includes('refactor') ||
      lower.includes('across the codebase')
    ) {
      return true;
    }
    return false;
  }

  return goal.length > 800;
}
