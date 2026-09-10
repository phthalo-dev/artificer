import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeConfig } from '../config.js';
import { findGitRepo } from '../engine/git-repo.js';
import type { Store } from '../storage/store.js';
import { truncateText } from '../tools/fetch-util.js';
import { runShellCommand } from '../tools/shell.js';
import { PortAllocator } from './port-allocator.js';
import {
  loadWorkspaceServiceConfig,
  resolveServiceConfig,
  type ServiceScriptConfig,
} from './workspace-config.js';

const CRASH_DETECTION_MS = 1500;
const STOP_GRACE_MS = 5000;

export interface ServiceState {
  name: string;
  pid: number;
  port: number;
  startedAt: string;
  script: string;
}

export type ServiceStartResult =
  | { status: 'started' | 'already_running'; port: number; url: string }
  | { status: 'error'; message: string };

export type ServiceStopResult = { status: 'stopped' | 'already_stopped' };
export interface ServiceListEntry {
  name: string;
  port: number;
  status: 'running' | 'stopped';
}
export type ServiceCheckResult =
  | { status: number; body: string }
  | { status: 'error'; message: string };

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface Resolved {
  svc: ServiceScriptConfig;
  repoRoot: string;
  workspaceDir: string;
}

export class ServiceManager {
  private readonly portAllocator = new PortAllocator();
  private readonly inFlight = new Map<string, Promise<ServiceStartResult>>();
  private readonly locks = new Map<string, Promise<void>>();

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(() => fn());
    const barrier = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, barrier);
    return run;
  }

  constructor(
    private readonly store: Store,
    private readonly config: RuntimeConfig,
  ) {}

  private readState(workstreamId: string): ServiceState[] {
    const file = this.store.layout.workstreamServicesStateFile(workstreamId);
    if (!fs.existsSync(file)) return [];
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as ServiceState[];
    } catch {
      return [];
    }
  }

  private writeState(workstreamId: string, states: ServiceState[]): void {
    const file = this.store.layout.workstreamServicesStateFile(workstreamId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(states, null, 2));
  }

  private async resolve(
    workstreamId: string,
    name: string,
  ): Promise<Resolved | { error: string }> {
    const workspaceDir = this.store.layout.workstreamWorkspace(workstreamId);
    const repoRoot = (await findGitRepo(workspaceDir)) ?? workspaceDir;
    const file = loadWorkspaceServiceConfig(repoRoot);
    const svc = resolveServiceConfig(
      file,
      name,
      this.config.workspaceServices,
    );
    if (!svc) return { error: `Unknown or disabled service "${name}".` };
    return { svc, repoRoot, workspaceDir };
  }

  async start(workstreamId: string, name: string): Promise<ServiceStartResult> {
    const key = `${workstreamId}:${name}`;
    const existingInFlight = this.inFlight.get(key);
    if (existingInFlight) return existingInFlight;

    const promise = this.withLock(key, () => this.doStart(workstreamId, name)).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async doStart(
    workstreamId: string,
    name: string,
  ): Promise<ServiceStartResult> {
    const resolved = await this.resolve(workstreamId, name);
    if ('error' in resolved) return { status: 'error', message: resolved.error };
    const { svc, repoRoot, workspaceDir } = resolved;

    const states = this.readState(workstreamId);
    const existing = states.find((s) => s.name === name);
    if (existing && isAlive(existing.pid)) {
      return {
        status: 'already_running',
        port: existing.port,
        url: `http://127.0.0.1:${existing.port}`,
      };
    }

    const setupMarker = path.join(
      workspaceDir,
      `.artificer-service-setup-${name}`,
    );
    if (svc.setup && !fs.existsSync(setupMarker)) {
      const result = await runShellCommand({
        command: svc.setup,
        cwd: repoRoot,
        env: process.env,
      });
      if (result.output.startsWith('Command failed:') || result.timedOut) {
        return { status: 'error', message: `setup failed: ${result.output}` };
      }
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(setupMarker, '');
    }

    const port = await this.portAllocator.allocate({
      min: svc.portRange[0],
      max: svc.portRange[1],
    });

    const logFile = this.store.layout.workstreamServiceLogFile(
      workstreamId,
      name,
    );
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const logFd = fs.openSync(logFile, 'a');

    const child = spawn(svc.run, {
      cwd: repoRoot,
      shell: true,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        ARTIFICER_SERVICE_NAME: name,
        ARTIFICER_SERVICE_PORT: String(port),
        ARTIFICER_SERVICE_URL: `http://127.0.0.1:${port}`,
        ARTIFICER_WORKSPACE_DIR: workspaceDir,
      },
    });
    child.unref();
    fs.closeSync(logFd);

    const crashed = await this.diedWithin(child, CRASH_DETECTION_MS);
    if (crashed) {
      this.portAllocator.release(port);
      const tail = fs.existsSync(logFile)
        ? fs.readFileSync(logFile, 'utf-8').slice(-2000)
        : '';
      return { status: 'error', message: `"${name}" exited immediately.\n${tail}` };
    }

    this.writeState(workstreamId, [
      ...states.filter((s) => s.name !== name),
      {
        name,
        pid: child.pid as number,
        port,
        startedAt: new Date().toISOString(),
        script: svc.run,
      },
    ]);

    return { status: 'started', port, url: `http://127.0.0.1:${port}` };
  }

  private diedWithin(child: ChildProcess, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, ms);
      child.once('exit', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
  }

  async stop(workstreamId: string, name: string): Promise<ServiceStopResult> {
    const key = `${workstreamId}:${name}`;
    return this.withLock(key, () => this.doStop(workstreamId, name));
  }

  private async doStop(
    workstreamId: string,
    name: string,
  ): Promise<{ status: 'stopped' | 'already_stopped' }> {
    const states = this.readState(workstreamId);
    const existing = states.find((s) => s.name === name);
    if (!existing || !isAlive(existing.pid)) {
      this.writeState(
        workstreamId,
        states.filter((s) => s.name !== name),
      );
      return { status: 'already_stopped' };
    }

    await this.killWithGrace(existing.pid);
    this.portAllocator.release(existing.port);
    this.writeState(
      workstreamId,
      states.filter((s) => s.name !== name),
    );

    const resolved = await this.resolve(workstreamId, name);
    if (!('error' in resolved) && resolved.svc.teardown) {
      try {
        await runShellCommand({
          command: resolved.svc.teardown,
          cwd: resolved.repoRoot,
          env: process.env,
        });
      } catch (err) {
        console.error(`[services] teardown for "${name}" failed:`, err);
      }
    }

    return { status: 'stopped' };
  }

  private async killWithGrace(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    const deadline = Date.now() + STOP_GRACE_MS;
    while (Date.now() < deadline) {
      if (!isAlive(pid)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }

  async list(workstreamId: string): Promise<ServiceListEntry[]> {
    return this.readState(workstreamId).map((s) => ({
      name: s.name,
      port: s.port,
      status: isAlive(s.pid) ? ('running' as const) : ('stopped' as const),
    }));
  }

  async check(workstreamId: string, name: string): Promise<ServiceCheckResult> {
    const existing = this.readState(workstreamId).find(
      (s) => s.name === name && isAlive(s.pid),
    );
    if (!existing) {
      return { status: 'error', message: `"${name}" is not running.` };
    }
    try {
      const res = await fetch(`http://127.0.0.1:${existing.port}`, {
        signal: AbortSignal.timeout(5000),
      });
      const text = await res.text();
      return { status: res.status, body: truncateText(text, 4000).text };
    } catch (err) {
      return {
        status: 'error',
        message: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async teardownWorkstream(workstreamId: string): Promise<void> {
    const states = this.readState(workstreamId);
    for (const s of states) {
      await this.stop(workstreamId, s.name);
    }
  }

  async reconcileAll(): Promise<void> {
    const workstreams = await this.store.listWorkstreams();
    for (const ws of workstreams) {
      const states = this.readState(ws.id);
      const alive = states.filter((s) => isAlive(s.pid));
      for (const s of alive) this.portAllocator.claim(s.port);
      if (alive.length !== states.length) {
        this.writeState(ws.id, alive);
      }
    }
  }
}
