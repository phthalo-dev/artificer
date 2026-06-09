import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface DockerBenchManifest {
  containerId: string;
  workDir: string;
  hostRepoDir: string;
}

export function dockerBenchManifestPath(dataDir: string): string {
  return path.join(dataDir, 'docker-bench.json');
}

export async function readDockerBenchManifest(
  dataDir: string,
): Promise<DockerBenchManifest | undefined> {
  try {
    const raw = await fs.readFile(dockerBenchManifestPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as DockerBenchManifest;
    if (parsed.containerId && parsed.workDir && parsed.hostRepoDir) return parsed;
  } catch {
    // no manifest
  }
  return undefined;
}

export async function writeDockerBenchManifest(
  dataDir: string,
  manifest: DockerBenchManifest,
): Promise<void> {
  await fs.writeFile(
    dockerBenchManifestPath(dataDir),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

/** Copy host repo edits into the evaluator container before run_shell. */
export async function syncHostRepoToContainer(
  manifest: DockerBenchManifest,
): Promise<void> {
  await exec(
    'docker',
    ['cp', `${manifest.hostRepoDir}/.`, `${manifest.containerId}:${manifest.workDir}`],
    { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
  );
}
