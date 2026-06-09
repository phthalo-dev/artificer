import type { BenchConfig } from './config.js';
import type { SuiteKind } from './types.js';

/** Generic defaults from loadBenchConfig (used to detect explicit overrides). */
export const GENERIC_BENCH_DEFAULTS = {
  instanceTimeoutMs: 1_200_000,
  maxRunsPerWorkstream: 40,
  maxIterationsPerCall: 30,
  maxIterationsPlanner: 15,
  maxCallDurationMs: 600_000,
  preflightClone: false,
  dockerMode: 'off' as const,
  singleLoop: false,
};

export type DockerMode = 'off' | 'auto' | 'on';

/**
 * Applies Harbor-aligned defaults for DeepSWE suites. Only overrides values
 * that still match generic defaults (CLI/env explicit settings win).
 */
export function applySuiteDefaults(
  config: BenchConfig,
  kind: SuiteKind,
): BenchConfig {
  if (kind !== 'deepswe') return config;

  const next = { ...config };

  if (config.noPreflightClone) {
    next.preflightClone = false;
  } else if (!config.preflightCloneExplicit) {
    next.preflightClone = true;
  }

  if (config.dockerMode === 'off' && !config.dockerModeExplicit) {
    next.dockerMode = 'auto';
  }

  if (config.maxRunsPerWorkstream === GENERIC_BENCH_DEFAULTS.maxRunsPerWorkstream) {
    next.maxRunsPerWorkstream = 100;
  }
  if (config.instanceTimeoutMs === GENERIC_BENCH_DEFAULTS.instanceTimeoutMs) {
    next.instanceTimeoutMs = 3_600_000;
  }
  if (config.maxCallDurationMs === GENERIC_BENCH_DEFAULTS.maxCallDurationMs) {
    next.maxCallDurationMs = 900_000;
  }
  if (config.maxIterationsPerCall === GENERIC_BENCH_DEFAULTS.maxIterationsPerCall) {
    next.maxIterationsPerCall = 50;
  }

  return next;
}
