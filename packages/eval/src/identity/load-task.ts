import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { parseEvalTaskManifest, type LoadedEvalTask } from '../types.js';
import { resolveEvalsDir } from './paths.js';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadEvalTask(
  identityDir: string,
  taskId: string,
): Promise<LoadedEvalTask> {
  const taskDir = path.join(resolveEvalsDir(identityDir), 'tasks', taskId);
  const [manifestRaw, prompt] = await Promise.all([
    fs.readFile(path.join(taskDir, 'eval.json'), 'utf8'),
    fs.readFile(path.join(taskDir, 'prompt.md'), 'utf8'),
  ]);

  const manifest = parseEvalTaskManifest(JSON.parse(manifestRaw));
  const loaded: LoadedEvalTask = {
    manifest,
    prompt,
    taskDir,
  };

  const fixtureDir = path.join(taskDir, 'fixture');
  if (await pathExists(fixtureDir)) {
    loaded.fixtureDir = fixtureDir;
  }

  const hiddenDir = path.join(taskDir, 'hidden');
  if (await pathExists(hiddenDir)) {
    loaded.hiddenDir = hiddenDir;
  }

  return loaded;
}

export async function listEvalTasks(identityDir: string): Promise<string[]> {
  const tasksDir = path.join(resolveEvalsDir(identityDir), 'tasks');
  let entries: Dirent[];
  try {
    entries = await fs.readdir(tasksDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const taskIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const evalPath = path.join(tasksDir, entry.name, 'eval.json');
    if (await pathExists(evalPath)) {
      taskIds.push(entry.name);
    }
  }

  return taskIds.sort();
}
