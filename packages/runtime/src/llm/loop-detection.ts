import type { LoopDetectionConfig } from './call-safety-config.js';

export interface LoopDetectionState {
  lastToolName: string;
  lastToolSignature: string;
  consecutiveIdenticalCount: number;
}

export const LOOP_WARNING_TEXT =
  'You appear to be repeating the same tool call. Try a different approach or change your inputs.';

export function createLoopDetectionState(): LoopDetectionState {
  return {
    lastToolName: '',
    lastToolSignature: '',
    consecutiveIdenticalCount: 0,
  };
}

export function resetLoopDetectionState(state: LoopDetectionState): void {
  state.lastToolName = '';
  state.lastToolSignature = '';
  state.consecutiveIdenticalCount = 0;
}

function sortKeys(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function toolCallSignature(input: unknown): string {
  if (input == null) return 'null';
  if (typeof input === 'string') return input;
  if (typeof input !== 'object') return String(input);
  try {
    return JSON.stringify(sortKeys(input));
  } catch {
    return String(input);
  }
}

export interface LoopCheckResult {
  softWarning: boolean;
  hardEscalation: boolean;
}

export function checkRepeatedToolCall(
  state: LoopDetectionState,
  toolName: string,
  signature: string,
  config: LoopDetectionConfig,
): LoopCheckResult {
  if (
    toolName === state.lastToolName &&
    signature === state.lastToolSignature
  ) {
    state.consecutiveIdenticalCount++;
  } else {
    state.consecutiveIdenticalCount = 1;
  }
  state.lastToolName = toolName;
  state.lastToolSignature = signature;

  return {
    softWarning: state.consecutiveIdenticalCount === config.softThreshold,
    hardEscalation: state.consecutiveIdenticalCount >= config.hardThreshold,
  };
}
