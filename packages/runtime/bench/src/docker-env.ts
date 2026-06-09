import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const CONTAINER_WORKDIR = '/app';
const CONTAINER_SLEEP = '2h';

export interface DockerBenchEnv {
  containerId: string;
  workDir: string;
  /** Copy the image's /app tree (with deps) into the host workspace repo dir. */
  bootstrapRepoToHost: (hostRepoDir: string) => Promise<void>;
  /** Sync host repo edits into the container before run_shell. */
  syncToContainer: (hostRepoDir: string) => Promise<void>;
  stop: () => Promise<void>;
}

function safeContainerName(instanceId: string): string {
  const slug = instanceId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48);
  return `artificer-bench-${slug}-${Date.now().toString(36)}`;
}

async function docker(args: string[], timeoutMs = 300_000): Promise<string> {
  const { stdout } = await exec('docker', args, {
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Starts a detached Harbor/DeepSWE evaluator image and exposes helpers to
 * bootstrap the repo onto the host workspace and execute shell in-container.
 */
export async function startDockerBenchEnv(
  image: string,
  instanceId: string,
): Promise<DockerBenchEnv> {
  const name = safeContainerName(instanceId);
  const containerId = await docker([
    'run',
    '-d',
    '--name',
    name,
    '-w',
    CONTAINER_WORKDIR,
    image,
    'sleep',
    CONTAINER_SLEEP,
  ]);

  const bootstrapRepoToHost = async (hostRepoDir: string): Promise<void> => {
    await fs.mkdir(hostRepoDir, { recursive: true });
    await docker(['cp', `${containerId}:${CONTAINER_WORKDIR}/.`, hostRepoDir]);
  };

  const syncToContainer = async (hostRepoDir: string): Promise<void> => {
    await docker(['cp', `${hostRepoDir}/.`, `${containerId}:${CONTAINER_WORKDIR}`]);
  };

  const stop = async (): Promise<void> => {
    await docker(['rm', '-f', containerId], 120_000).catch(() => undefined);
  };

  return {
    containerId,
    workDir: CONTAINER_WORKDIR,
    bootstrapRepoToHost,
    syncToContainer,
    stop,
  };
}

/** Host path to the repo directory inside a workstream workspace. */
export function hostRepoDir(workspaceDir: string): string {
  return path.join(workspaceDir, 'repo');
}
