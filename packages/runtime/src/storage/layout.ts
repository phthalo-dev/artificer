import path from 'node:path';

/**
 * Resolves on-disk paths for every kind of persisted artifact. All work
 * history lives under a single data directory so the agent's memory is just
 * files on the system.
 */
export class Layout {
  constructor(public readonly root: string) {}

  get messagesDir(): string {
    return path.join(this.root, 'messages');
  }

  get workstreamsDir(): string {
    return path.join(this.root, 'workstreams');
  }

  get runsDir(): string {
    return path.join(this.root, 'runs');
  }

  get memoriesDir(): string {
    return path.join(this.root, 'memories');
  }

  get workspaceDir(): string {
    return path.join(this.root, 'workspace');
  }

  messageFile(id: string, createdAt: string): string {
    return path.join(this.messagesDir, `${createdAt}-${id}.json`);
  }

  workstreamDir(id: string): string {
    return path.join(this.workstreamsDir, id);
  }

  workstreamFile(id: string): string {
    return path.join(this.workstreamDir(id), 'workstream.json');
  }

  planFile(id: string): string {
    return path.join(this.workstreamDir(id), 'plan.md');
  }

  tasksDir(workstreamId: string): string {
    return path.join(this.workstreamDir(workstreamId), 'tasks');
  }

  taskFile(workstreamId: string, taskId: string): string {
    return path.join(this.tasksDir(workstreamId), `${taskId}.json`);
  }

  reviewsDir(workstreamId: string): string {
    return path.join(this.workstreamDir(workstreamId), 'reviews');
  }

  reviewFile(workstreamId: string, reviewId: string): string {
    return path.join(this.reviewsDir(workstreamId), `${reviewId}.json`);
  }

  runFile(id: string): string {
    return path.join(this.runsDir, `${id}.json`);
  }

  memoryFile(id: string, createdAt: string): string {
    return path.join(this.memoriesDir, `${createdAt}-${id}.json`);
  }

  memoryIndexFile(): string {
    return path.join(this.memoriesDir, 'index.json');
  }

  /** Per-workstream workspace where repos are cloned and files are edited. */
  workstreamWorkspace(workstreamId: string): string {
    return path.join(this.workspaceDir, workstreamId);
  }

  /** Spilled tool-result bodies for a run (large outputs kept off the prompt). */
  toolResultsDir(runId: string): string {
    return path.join(this.root, 'tool-results', runId);
  }

  /** Per-workstream LRU of recently read files for context hints. */
  workstreamFileCacheFile(workstreamId: string): string {
    return path.join(this.workstreamDir(workstreamId), 'file-cache.json');
  }
}
