import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PRESET_ID, getPreset } from './presets.js';
import type { RoleName } from '../../src/storage/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo paths derived relative to this file (bench/src). */
export const BENCH_DIR = path.resolve(here, '..');
export const RUNTIME_ROOT = path.resolve(BENCH_DIR, '..');
export const TASKS_DIR = path.join(BENCH_DIR, 'tasks');
export const RESULTS_DIR = path.join(BENCH_DIR, 'results');
export const CACHE_DIR = path.join(TASKS_DIR, '.cache');

/** Resolved configuration for a benchmark run. */
export interface BenchConfig {
  /** Path to the suite definition JSON. */
  suitePath: string;
  /** Optional explicit instance id filter (overrides the suite's list). */
  instanceIds?: string[];
  /** Cap the number of instances actually run. */
  limit?: number;
  /** Port the spawned runtime listens on. */
  runtimePort: number;
  /** How often to poll the runtime for progress, in ms. */
  pollIntervalMs: number;
  /** Per-instance wall-clock budget before giving up, in ms. */
  instanceTimeoutMs: number;
  /** Safety cap on LLM calls per workstream (passed to the runtime). */
  maxRunsPerWorkstream: number;
  /** Max tool-use iterations per call (passed to the runtime). */
  maxIterationsPerCall: number;
  /** Lower iteration cap for planner calls in bench runs. */
  maxIterationsPlanner: number;
  /** Per-call wall-clock limit passed to the runtime, in ms. */
  maxCallDurationMs: number;
  /** Model ids per tier, pinned for reproducibility. */
  models: { low: string; medium: string; high: string };
  /** Role -> tier map passed to spawned runtimes. */
  roleTiers: Record<RoleName, 'low' | 'medium' | 'high'>;
  /** Preset id when loaded from a named profile. */
  presetId?: string;
  /** Label written into predictions as model_name_or_path. */
  modelName: string;
  /** Keep each instance's temp data dir instead of deleting it. */
  keepData: boolean;
  /** Directory where results (predictions, attempts, report) are written. */
  resultsDir: string;
  /** Stream live workstream/run progress lines while an instance runs. */
  liveProgress: boolean;
  /** Include per-tool-call lines in the live progress stream. */
  showTools: boolean;
  /** Clone repo into workspace before the agent runs (Harbor-style eval). */
  preflightClone: boolean;
}

function flag(args: string[], name: string): string | undefined {
  const withEq = args.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return undefined;
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** Resolve suite paths relative to the bench root (handles `tasks/foo.json` from any cwd). */
function resolveSuitePath(raw: string | undefined): string {
  if (!raw) return path.join(TASKS_DIR, 'mini-suite.json');
  if (path.isAbsolute(raw)) return raw;
  if (raw.startsWith('tasks/') || raw.startsWith('tasks\\')) {
    return path.resolve(BENCH_DIR, raw);
  }
  return path.join(TASKS_DIR, raw);
}

/**
 * Resolves the benchmark config from CLI args and environment, applying
 * reproducibility-friendly defaults (single-instance isolation, pinned models).
 */
export function loadBenchConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): BenchConfig {
  const idsArg = flag(argv, 'instance-ids');
  const limitArg = flag(argv, 'limit');

  const presetArg = flag(argv, 'preset');
  const presetId = presetArg ?? env.BENCH_PRESET ?? env.MODEL_PRESET;
  const preset = presetId ? getPreset(presetId) : getPreset(DEFAULT_PRESET_ID)!;

  // CLI model flags win; then preset tiers (reproducible bench runs); then env.
  const models = {
    low:
      flag(argv, 'model-low') ??
      preset.tiers.low ??
      env.LLM_MODEL_LOW,
    medium:
      flag(argv, 'model') ??
      preset.tiers.medium ??
      env.LLM_MODEL,
    high:
      flag(argv, 'model-high') ??
      preset.tiers.high ??
      env.LLM_MODEL_HIGH,
  };

  const roleTiers = { ...preset.roleTiers } as Record<
    RoleName,
    'low' | 'medium' | 'high'
  >;
  for (const role of Object.keys(roleTiers) as RoleName[]) {
    const override = env[`RUNTIME_TIER_${role.toUpperCase()}`];
    if (override === 'low' || override === 'medium' || override === 'high') {
      roleTiers[role] = override;
    }
  }

  const suitePath = resolveSuitePath(flag(argv, 'suite'));
  const suiteBase = path.basename(suitePath, '.json');
  const defaultResultsDir = presetId
    ? path.join(RESULTS_DIR, presetId, suiteBase)
    : RESULTS_DIR;

  const explicitModelName = flag(argv, 'model-name') ?? env.BENCH_MODEL_NAME;
  const modelName =
    explicitModelName ??
    (presetId ? `${presetId}/${suiteBase}` : 'artificer-runtime');

  return {
    suitePath,
    instanceIds: idsArg
      ? idsArg
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    limit: limitArg ? Number(limitArg) : undefined,
    runtimePort: Number(flag(argv, 'port') ?? env.BENCH_RUNTIME_PORT ?? 4111),
    pollIntervalMs: Number(
      flag(argv, 'poll-ms') ?? env.BENCH_POLL_MS ?? 5_000,
    ),
    instanceTimeoutMs: Number(
      flag(argv, 'timeout-ms') ?? env.BENCH_TIMEOUT_MS ?? 1_200_000,
    ),
    maxRunsPerWorkstream: Number(
      flag(argv, 'max-runs') ?? env.BENCH_MAX_RUNS ?? 40,
    ),
    maxIterationsPerCall: Number(
      flag(argv, 'max-iterations') ?? env.BENCH_MAX_ITERATIONS ?? 30,
    ),
    maxIterationsPlanner: Number(
      flag(argv, 'max-iterations-planner') ??
        env.BENCH_MAX_ITERATIONS_PLANNER ??
        15,
    ),
    maxCallDurationMs: Number(
      flag(argv, 'max-call-duration-ms') ??
        env.BENCH_MAX_CALL_DURATION_MS ??
        600_000,
    ),
    models,
    roleTiers,
    presetId: presetId ?? preset.id,
    modelName,
    keepData: boolFlag(argv, 'keep-data') || env.BENCH_KEEP_DATA === 'true',
    resultsDir: flag(argv, 'results-dir') ?? env.BENCH_RESULTS_DIR ?? defaultResultsDir,
    liveProgress: !boolFlag(argv, 'quiet') && env.BENCH_QUIET !== 'true',
    showTools: !boolFlag(argv, 'quiet-tools') && env.BENCH_QUIET_TOOLS !== 'true',
    preflightClone:
      boolFlag(argv, 'preflight-clone') ||
      env.BENCH_PREFLIGHT_CLONE === 'true',
  };
}
