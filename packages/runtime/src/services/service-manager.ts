import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeConfig } from '../config.js';
import { findGitRepo } from '../engine/git-repo.js';
import type { Store } from '../storage/store.js';
import { runShellCommand } from '../tools/shell.js';
import { PortAllocator } from './port-allocator.js';
import {
  loadWorkspaceServiceConfig,
  resolveServiceConfig,
  type ServiceScriptConfig,
} from './workspace-config.js';

const CRASH_DETECTION_MS = 1500;

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

    const promise = this.doStart(workstreamId, name).finally(() => {
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
}
