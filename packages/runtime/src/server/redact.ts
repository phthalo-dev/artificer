import type { ExecutorConfig } from '../api/types.js';

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
