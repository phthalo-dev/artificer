import type { ExecutorConfig } from './api/types.js';

export const REDACTED = '[redacted]';

/** Copy of an executor config with every `env` value masked (keys kept). */
export function redactExecutorConfig<
  T extends ExecutorConfig | null | undefined,
>(executor: T): T {
  if (!executor || typeof executor !== 'object') return executor;
  const env = (executor as { env?: Record<string, string> }).env;
  if (!env || typeof env !== 'object') return executor;
  return {
    ...executor,
    env: Object.fromEntries(Object.keys(env).map((k) => [k, REDACTED])),
  };
}

/** Redacts `executor` on a workstream-shaped object for API responses. */
export function redactWorkstream<T extends { executor?: ExecutorConfig }>(
  workstream: T,
): T {
  if (!workstream.executor) return workstream;
  return { ...workstream, executor: redactExecutorConfig(workstream.executor) };
}

/** Redacts executor env on `workstream` events before they leave the process. */
export function redactRuntimeEvent<T extends { kind: string; data?: unknown }>(
  event: T,
): T {
  if (event.kind !== 'workstream') return event;
  const data = event.data;
  if (!data || typeof data !== 'object') return event;
  return {
    ...event,
    data: redactWorkstream(data as { executor?: ExecutorConfig }),
  };
}

const EXECUTOR_KEYS = new Set(['executor', 'execution']);

/**
 * Deep copy of `value` with every `executor` / `execution` field passed
 * through `redactExecutorConfig`. For quota configs and snapshots, whose
 * routes and failover targets embed executor configs at several depths.
 */
export function redactExecutorsDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => redactExecutorsDeep(v)) as unknown as T;
  }
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] =
      EXECUTOR_KEYS.has(k) && v && typeof v === 'object' && !Array.isArray(v)
        ? redactExecutorConfig(redactExecutorsDeep(v) as ExecutorConfig)
        : redactExecutorsDeep(v);
  }
  return out as T;
}
