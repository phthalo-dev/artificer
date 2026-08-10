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

interface GatewayProfile {
  baseUrl: string;
  /** Name of the env var that holds the API key for this gateway. */
  apiKeyEnv: string;
  /** Default preset when none is specified via --preset / BENCH_PRESET. */
  defaultPreset: string;
}

const GATEWAY_PROFILES: Record<string, GatewayProfile> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultPreset: 'quality-first',
  },
  'opencode-zen': {
    baseUrl: 'https://opencode.ai/zen/v1',
    apiKeyEnv: 'OPENCODE_API_KEY',
    defaultPreset: 'async-economy',
  },
  'opencode-go': {
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKeyEnv: 'OPENCODE_API_KEY',
    defaultPreset: 'go-economy',
  },
};

const GATEWAY_ALIASES: Record<string, string> = {
  go: 'opencode-go',
  zen: 'opencode-zen',
  claude: 'anthropic',
};

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
  /** Pause between instances, in ms (helps avoid provider rate-limit stalls). */
  instanceDelayMs: number;
  /**
   * Resolved gateway name (e.g. "opencode-go"). Set when --gateway was passed.
   * Controls which LLM_BASE_URL and LLM_API_KEY the spawned runtime uses.
   */
  gateway?: string;
  /**
   * LLM base URL resolved from --gateway. Overrides the .env value in the
   * spawned runtime so bench runs don't require manual .env edits.
   */
  baseUrl?: string;
  /**
   * API key resolved from --gateway. Overrides LLM_API_KEY in the spawned
   * runtime. Not written to run-config.json.
   */
  apiKey?: string;
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
export function resolveSuitePath(raw: string | undefined): string {
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
 *
 * Pass `--gateway <name>` to select a provider without editing .env:
 *   anthropic / claude  — Anthropic direct (ANTHROPIC_API_KEY, quality-first preset)
 *   opencode-zen / zen  — OpenCode Zen    (OPENCODE_API_KEY, async-economy preset)
 *   opencode-go  / go   — OpenCode Go     (OPENCODE_API_KEY, go-economy preset)
 *
 * The gateway sets a default preset but --preset still wins when specified.
 */
export function loadBenchConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): BenchConfig {
  const idsArg = flag(argv, 'instance-ids');
  const limitArg = flag(argv, 'limit');

  // Resolve gateway profile (--gateway flag or BENCH_GATEWAY env var).
  const gatewayArg = flag(argv, 'gateway') ?? env.BENCH_GATEWAY;
  const gatewayKey = gatewayArg
    ? (GATEWAY_ALIASES[gatewayArg] ?? gatewayArg)
    : undefined;
  const gatewayProfile = gatewayKey ? GATEWAY_PROFILES[gatewayKey] : undefined;
  if (gatewayArg && !gatewayProfile) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bench] unknown --gateway "${gatewayArg}"; valid values: ` +
        [...Object.keys(GATEWAY_PROFILES), ...Object.keys(GATEWAY_ALIASES)].join(', '),
    );
  }

  // Preset: explicit flag wins, then env, then the gateway's recommended default.
  const presetArg = flag(argv, 'preset');
  const presetId =
    presetArg ?? env.BENCH_PRESET ?? env.MODEL_PRESET ?? gatewayProfile?.defaultPreset;
  const preset = (presetId ? getPreset(presetId) : null) ?? getPreset(DEFAULT_PRESET_ID)!;

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
  const resolvedPresetId = presetId ?? preset.id;
  const defaultResultsDir = resolvedPresetId
    ? path.join(RESULTS_DIR, resolvedPresetId, suiteBase)
    : RESULTS_DIR;

  const explicitModelName = flag(argv, 'model-name') ?? env.BENCH_MODEL_NAME;
  const modelName =
    explicitModelName ??
    (resolvedPresetId ? `${resolvedPresetId}/${suiteBase}` : 'artificer-runtime');

  // Resolve gateway key/URL — falls back to LLM_* env vars (from .env) when no
  // --gateway flag is passed, so existing behaviour is unchanged.
  const baseUrl = gatewayProfile?.baseUrl;
  const apiKey = gatewayProfile
    ? (env[gatewayProfile.apiKeyEnv] ?? env.LLM_API_KEY)
    : undefined;

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
    models,
    roleTiers,
    presetId: resolvedPresetId,
    modelName,
    keepData: boolFlag(argv, 'keep-data') || env.BENCH_KEEP_DATA === 'true',
    resultsDir: flag(argv, 'results-dir') ?? env.BENCH_RESULTS_DIR ?? defaultResultsDir,
    liveProgress: !boolFlag(argv, 'quiet') && env.BENCH_QUIET !== 'true',
    showTools: !boolFlag(argv, 'quiet-tools') && env.BENCH_QUIET_TOOLS !== 'true',
    preflightClone:
      boolFlag(argv, 'preflight-clone') ||
      env.BENCH_PREFLIGHT_CLONE === 'true',
    instanceDelayMs: Number(
      flag(argv, 'instance-delay-ms') ?? env.BENCH_INSTANCE_DELAY_MS ?? 0,
    ),
    gateway: gatewayKey,
    baseUrl,
    apiKey,
  };
}
