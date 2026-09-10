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

/**
 * Runtime shape check for a persisted ServiceState entry. The state file
 * lives under the workstream workspace, which the worker/reviewer roles'
 * write_file tool can write to directly — so it must be treated as
 * untrusted input, not just typed with a bare assertion. In particular
 * `port` must be a real integer: `check()` interpolates it directly into a
 * URL, and a non-numeric string there (e.g. "1@evil.example.com") can be
 * used to redirect the request to an arbitrary host.
 */
function isValidServiceState(value: unknown): value is ServiceState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    Number.isInteger(v.pid) &&
    Number.isInteger(v.port) &&
    typeof v.startedAt === 'string' &&
    typeof v.script === 'string'
  );
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

  /**
   * A simple promise-chained mutex. Keys are namespaced by the caller
   * (e.g. `${workstreamId}:${name}` for per-service locks, `ws:${id}` for
   * per-workstream state-file locks below) so distinct lock "kinds" never
   * collide. No code path holds one kind of lock while waiting on the
   * other, so there's no cross-kind deadlock risk.
   */
  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(() => fn());
    const barrier = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, barrier);
    // Once this call's turn has fully settled, drop the map entry if
    // nobody queued behind it — otherwise `locks` would accumulate one
    // permanent entry per distinct (workstreamId, name) or workstreamId
    // ever seen, for the life of the process.
    barrier.finally(() => {
      if (this.locks.get(key) === barrier) {
        this.locks.delete(key);
      }
    });
    return run;
  }

  /**
   * Atomically reads, transforms, and writes back a workstream's service
   * state file. Locked per-workstream (not per-service) so two DIFFERENT
   * services being started/stopped concurrently in the same workstream
   * can't each read a stale snapshot and clobber each other's write. Uses
   * a `ws:`-prefixed key, which is disjoint from the `${workstreamId}:${name}`
   * keys used by the per-service start/stop locks.
   */
  private mutateState(
    workstreamId: string,
    fn: (states: ServiceState[]) => ServiceState[],
  ): Promise<void> {
    return this.withLock(`ws:${workstreamId}`, async () => {
      this.writeState(workstreamId, fn(this.readState(workstreamId)));
    });
  }

  constructor(
    private readonly store: Store,
    private readonly config: RuntimeConfig,
  ) {}

  private readState(workstreamId: string): ServiceState[] {
    const file = this.store.layout.workstreamServicesStateFile(workstreamId);
    if (!fs.existsSync(file)) return [];
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidServiceState);
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
    const svc = resolveServiceConfig(file, name, this.config.workspaceServices);
    if (!svc) return { error: `Unknown or disabled service "${name}".` };
    return { svc, repoRoot, workspaceDir };
  }

  async start(workstreamId: string, name: string): Promise<ServiceStartResult> {
    const key = `${workstreamId}:${name}`;
    const existingInFlight = this.inFlight.get(key);
    if (existingInFlight) return existingInFlight;

    const promise = this.withLock(key, () =>
      this.doStart(workstreamId, name),
    ).finally(() => {
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
    if ('error' in resolved)
      return { status: 'error', message: resolved.error };
    const { svc, repoRoot, workspaceDir } = resolved;

    // Only this exact (workstreamId, name) can be in doStart/doStop at once
    // (serialized by the per-service lock in start()/stop()), so this read
    // is safe to use for the "already running" check even though the final
    // write below goes through the atomic per-workstream mutateState.
    const states = this.readState(workstreamId);
    const existing = states.find((s) => s.name === name);
    if (existing && isAlive(existing.pid)) {
      return {
        status: 'already_running',
        port: existing.port,
        url: `http://127.0.0.1:${existing.port}`,
      };
    }
    if (existing) {
      // Dead entry left behind by a crash (or an external kill) - release
      // its stale port claim now, before allocating a new one below, so
      // restarts don't permanently leak the old port.
      this.portAllocator.release(existing.port);
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

    const outcome = await this.awaitSpawnOutcome(child, CRASH_DETECTION_MS);
    if (outcome.status === 'error') {
      this.portAllocator.release(port);
      if (outcome.reason === 'crashed') {
        const tail = fs.existsSync(logFile)
          ? fs.readFileSync(logFile, 'utf-8').slice(-2000)
          : '';
        return {
          status: 'error',
          message: `"${name}" exited immediately.\n${tail}`,
        };
      }
      return {
        status: 'error',
        message: `failed to spawn "${name}": ${outcome.message}`,
      };
    }

    const pid = child.pid;
    if (!pid) {
      // Spawn can resolve without an 'error' or 'exit' event yet still
      // fail to assign a pid on some platforms/failure modes - never
      // persist a state entry we can't later signal or verify liveness of.
      this.portAllocator.release(port);
      return {
        status: 'error',
        message: `failed to spawn "${name}": no pid was assigned to the child process.`,
      };
    }

    await this.mutateState(workstreamId, (current) => [
      ...current.filter((s) => s.name !== name),
      {
        name,
        pid,
        port,
        startedAt: new Date().toISOString(),
        script: svc.run,
      },
    ]);

    return { status: 'started', port, url: `http://127.0.0.1:${port}` };
  }

  /**
   * Waits up to `ms` for the freshly spawned child to either die (`'exit'`)
   * or fail to spawn at all (`'error'` - e.g. EMFILE/EAGAIN/ENOMEM, or a
   * missing shell). Both listeners are attached synchronously, in the same
   * tick as `spawn()`, before any `await` - `ChildProcess` is an
   * EventEmitter, and an unhandled `'error'` event throws synchronously and
   * takes down the whole process absent a listener, so this must never be
   * skipped.
   */
  private awaitSpawnOutcome(
    child: ChildProcess,
    ms: number,
  ): Promise<
    | { status: 'ok' }
    | { status: 'error'; reason: 'crashed' }
    | { status: 'error'; reason: 'spawn-error'; message: string }
  > {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ status: 'ok' });
        }
      }, ms);
      child.once('exit', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ status: 'error', reason: 'crashed' });
        }
      });
      child.once('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            status: 'error',
            reason: 'spawn-error',
            message: err instanceof Error ? err.message : String(err),
          });
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
  ): Promise<ServiceStopResult> {
    // Serialized per (workstreamId, name) by stop()'s per-service lock, so
    // this read is safe to use for the liveness check; the actual removal
    // still goes through the atomic per-workstream mutateState below.
    const states = this.readState(workstreamId);
    const existing = states.find((s) => s.name === name);
    if (!existing || !isAlive(existing.pid)) {
      if (existing) {
        // Entry is tracked but the process is already gone (crashed, or
        // killed outside the manager) - release its port claim, otherwise
        // it leaks forever since PortAllocator.allocate never reuses a
        // still-claimed port even if nothing is listening on it anymore.
        this.portAllocator.release(existing.port);
      }
      await this.mutateState(workstreamId, (current) =>
        current.filter((s) => s.name !== name),
      );
      return { status: 'already_stopped' };
    }

    await this.killWithGrace(existing.pid);
    this.portAllocator.release(existing.port);
    await this.mutateState(workstreamId, (current) =>
      current.filter((s) => s.name !== name),
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
        // Runs at startup, before any start()/stop() calls exist for these
        // workstreams, but route through the same atomic helper as
        // everything else so this stays correct if that ever changes.
        await this.mutateState(ws.id, (current) =>
          current.filter((s) => isAlive(s.pid)),
        );
      }
    }
  }
}
