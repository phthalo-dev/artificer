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

  findingsDir(workstreamId: string): string {
    return path.join(this.workstreamDir(workstreamId), 'findings');
  }

  findingFile(workstreamId: string, findingId: string): string {
    return path.join(this.findingsDir(workstreamId), `${findingId}.json`);
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

  /** Hash-stable snapshots of volatile buildContext sections. */
  contextSectionsFile(workstreamId: string): string {
    return path.join(this.workstreamDir(workstreamId), 'context-sections.json');
  }

  /** Stores the identity memory ID for a workstream so updates survive restarts. */
  workstreamMemoryRefFile(workstreamId: string): string {
    return path.join(this.workstreamDir(workstreamId), 'memory-ref.txt');
  }

  /** Hash of the last workstream distill (goal+summary+status) for skip-if-unchanged. */
  workstreamDistillHashFile(workstreamId: string): string {
    return path.join(this.workstreamDir(workstreamId), 'distill-hash.txt');
  }

  /** Tracked service processes (name/pid/port) for a workstream's workspace. */
  workstreamServicesStateFile(workstreamId: string): string {
    return path.join(
      this.workstreamWorkspace(workstreamId),
      '.artificer-services.json',
    );
  }

  /** Directory holding captured stdout/stderr for a workstream's services. */
  workstreamServiceLogsDir(workstreamId: string): string {
    return path.join(
      this.workstreamWorkspace(workstreamId),
      '.artificer-service-logs',
    );
  }

  workstreamServiceLogFile(workstreamId: string, name: string): string {
    return path.join(
      this.workstreamServiceLogsDir(workstreamId),
      `${name}.log`,
    );
  }

  /** Cursor/state for the GitHub activity watcher (own PRs + notifications). */
  githubWatchStateFile(): string {
    return path.join(this.root, 'github-watch-state.json');
  }

  /** Last-fired timestamps for recurring schedules. */
  scheduleStateFile(): string {
    return path.join(this.root, 'schedule-state.json');
  }

  quotaStateFile(): string {
    return path.join(this.root, 'quota-state.json');
  }

  toolPolicyFile(): string {
    return path.join(this.root, 'tool-policy.json');
  }

  historyIndexFile(): string {
    return path.join(this.root, 'history', 'index.json');
  }
}
