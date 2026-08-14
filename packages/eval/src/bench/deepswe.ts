import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_DIR } from './config.js';
import type { BenchInstance } from './types.js';

const DEEPSWE_REPO = 'datacurve-ai/deep-swe';
const RAW_BASE = `https://raw.githubusercontent.com/${DEEPSWE_REPO}/main/tasks`;

export interface DeepSweTaskMeta {
  task_id: string;
  display_title?: string;
  language?: string;
  repository_url: string;
  base_commit_hash: string;
  docker_image?: string;
}

function parseTomlString(raw: string, key: string): string | undefined {
  const m = raw.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m?.[1];
}

function repoFromUrl(url: string): string {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!m) throw new Error(`cannot parse GitHub repo from ${url}`);
  return m[1].replace(/\.git$/, '');
}

function taskCacheDir(taskId: string): string {
  return path.join(CACHE_DIR, 'deepswe', taskId);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** Downloads and caches one DeepSWE Harbor task directory (metadata + prompt). */
export async function loadDeepSweTask(taskId: string): Promise<BenchInstance> {
  const dir = taskCacheDir(taskId);
  const metaPath = path.join(dir, 'task.toml');
  const instructionPath = path.join(dir, 'instruction.md');

  let toml: string;
  let instruction: string;
  try {
    toml = await fs.readFile(metaPath, 'utf8');
    instruction = await fs.readFile(instructionPath, 'utf8');
  } catch {
    const [tomlRemote, instructionRemote] = await Promise.all([
      fetchText(`${RAW_BASE}/${taskId}/task.toml`),
      fetchText(`${RAW_BASE}/${taskId}/instruction.md`),
    ]);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(metaPath, tomlRemote, 'utf8');
    await fs.writeFile(instructionPath, instructionRemote, 'utf8');
    toml = tomlRemote;
    instruction = instructionRemote;
  }

  const repositoryUrl =
    parseTomlString(toml, 'repository_url') ??
    parseTomlString(toml, 'repositoryUrl');
  const baseCommit =
    parseTomlString(toml, 'base_commit_hash') ??
    parseTomlString(toml, 'base_commit');
  if (!repositoryUrl || !baseCommit) {
    throw new Error(
      `task ${taskId}: missing repository_url or base_commit_hash`,
    );
  }

  const meta: DeepSweTaskMeta = {
    task_id: parseTomlString(toml, 'task_id') ?? taskId,
    display_title: parseTomlString(toml, 'display_title'),
    language: parseTomlString(toml, 'language'),
    repository_url: repositoryUrl,
    base_commit_hash: baseCommit,
    docker_image: parseTomlString(toml, 'docker_image'),
  };

  return {
    instance_id: meta.task_id,
    repo: repoFromUrl(meta.repository_url),
    base_commit: meta.base_commit_hash,
    problem_statement: instruction.trim(),
    suite: 'deepswe',
    language: meta.language,
    repository_url: meta.repository_url,
    docker_image: meta.docker_image,
    display_title: meta.display_title,
  };
}

/** Loads a curated list of DeepSWE tasks, preserving request order. */
export async function loadDeepSweInstances(
  taskIds: string[],
): Promise<BenchInstance[]> {
  const found: BenchInstance[] = [];
  const missing: string[] = [];
  for (const id of taskIds) {
    try {
      found.push(await loadDeepSweTask(id));
    } catch (err) {
      missing.push(id);
      // eslint-disable-next-line no-console
      console.warn(
        `[bench] failed to load DeepSWE task ${id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bench] ${missing.length} DeepSWE task(s) unavailable: ${missing.join(', ')}`,
    );
  }
  return found;
}
