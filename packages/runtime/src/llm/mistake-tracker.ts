export interface MistakeTrackerState {
  consecutiveMistakes: number;
}

export function createMistakeTrackerState(): MistakeTrackerState {
  return { consecutiveMistakes: 0 };
}

export function resetMistakeTrackerState(state: MistakeTrackerState): void {
  state.consecutiveMistakes = 0;
}

export type StepOutcome =
  | 'productive'
  | 'all_tools_failed'
  | 'api_error'
  | 'invalid_tool_calls';

export function recordStepOutcome(
  state: MistakeTrackerState,
  outcome: StepOutcome,
  maxConsecutiveMistakes: number,
): { shouldAbort: boolean; reason?: string } {
  if (outcome === 'productive') {
    resetMistakeTrackerState(state);
    return { shouldAbort: false };
  }

  state.consecutiveMistakes += 1;

  if (maxConsecutiveMistakes > 0 && state.consecutiveMistakes >= maxConsecutiveMistakes) {
    return {
      shouldAbort: true,
      reason: `Stopped after ${state.consecutiveMistakes}/${maxConsecutiveMistakes} consecutive mistakes (${outcome}).`,
    };
  }

  return { shouldAbort: false };
}

function toolResultOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (
    output &&
    typeof output === 'object' &&
    'value' in output &&
    typeof (output as { value: unknown }).value === 'string'
  ) {
    return (output as { value: string }).value;
  }
  return output == null ? '' : String(output);
}

function isToolResultError(result: { output?: unknown; isError?: boolean }): boolean {
  if (result.isError) return true;
  return toolResultOutputText(result.output).startsWith('Error:');
}

export function classifyStepFromToolResults(
  toolResults: Array<{ output?: unknown; isError?: boolean }>,
  finishReason?: string,
): StepOutcome {
  if (finishReason === 'error') {
    return 'api_error';
  }

  if (
    toolResults.length > 0 &&
    toolResults.every((result) => isToolResultError(result))
  ) {
    return 'all_tools_failed';
  }

  return 'productive';
}
