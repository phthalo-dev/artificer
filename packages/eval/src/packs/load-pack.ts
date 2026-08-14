import type { BenchInstance } from '../bench/types.js';
import { loadInstances } from '../bench/dataset.js';
import { buildTaskMessage } from '../bench/run-instance.js';
import type { EvalSuiteDefinition, LoadedEvalTask } from '../types.js';
import { getEvalPack, type EvalPackDefinition } from './registry.js';

const SWE_BENCH_TIMEOUT_MS = 1_200_000;

export interface LoadedEvalPack {
  pack: EvalPackDefinition;
  suite: EvalSuiteDefinition;
  tasks: LoadedEvalTask[];
}

export interface LoadEvalPackOptions {
  packId: string;
  /** Cap how many instances actually run (after pack order). */
  limit?: number;
  loadInstances?: typeof loadInstances;
}

export function sweBenchInstanceToEvalTask(
  instance: BenchInstance,
): LoadedEvalTask {
  const repoUrl =
    instance.repository_url ?? `https://github.com/${instance.repo}.git`;
  return {
    manifest: {
      id: instance.instance_id,
      title: instance.display_title ?? instance.instance_id,
      kind: 'repo-patch',
      timeoutMs: SWE_BENCH_TIMEOUT_MS,
      tags: ['swebench', instance.suite],
      repo: {
        url: repoUrl,
        baseCommit: instance.base_commit,
      },
      grade: { type: 'swebench' },
    },
    prompt: buildTaskMessage(instance, { preflight: true }),
    taskDir: '',
  };
}

export async function loadEvalPack(
  options: LoadEvalPackOptions,
): Promise<LoadedEvalPack> {
  const pack = getEvalPack(options.packId);
  const load = options.loadInstances ?? loadInstances;
  const ids =
    options.limit && options.limit > 0
      ? pack.instanceIds.slice(0, options.limit)
      : [...pack.instanceIds];
  const instances = await load(pack.dataset, pack.split, pack.config, ids);
  const tasks = instances.map(sweBenchInstanceToEvalTask);
  return {
    pack,
    suite: {
      name: pack.name,
      description: pack.description,
      taskIds: tasks.map((task) => task.manifest.id),
    },
    tasks,
  };
}
