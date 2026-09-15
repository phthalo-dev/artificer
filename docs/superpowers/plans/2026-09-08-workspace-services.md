# Workspace Run/Service Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `worker` and `reviewer` roles start, stop, list, and check named long-lived dev-server processes declared in a project's `.artificer/workspace.json`, closing the gap where `run_shell` can only run commands to completion.

**Architecture:** A new `ServiceManager` (in `packages/runtime/src/services/`) owns process spawn/kill/port-allocation and persists state to a per-workstream JSON file. It's exposed to tools as four new `EngineApi` methods (mirroring how schedules are already exposed), with a teardown hook on `Engine.handleWorkstreamTerminal` and a reattach scan at runtime startup.

**Tech Stack:** Node.js `child_process`/`net` (no new dependencies), `node:test` + `node:assert/strict` (existing test convention in this package).

**Spec:** [docs/superpowers/specs/2026-09-08-workspace-services-design.md](../specs/2026-09-08-workspace-services-design.md)

## Global Constraints

- Node.js 21+ (repo-wide requirement; global `fetch`/`AbortSignal.timeout` used directly, no polyfill).
- No changes to `run_shell`, existing worker executors, or the tool-approval-policy mechanism — `setup`/`teardown` reuse the existing, unmodified `runShellCommand()` from `packages/runtime/src/tools/shell.ts`.
- `start_service`/`stop_service`/`list_services`/`check_service` are available to the `worker` and `reviewer` roles only, and are never approval-gated (no `needsApproval`).
- `start_service` and `stop_service` are idempotent — calling either on an already-in-that-state service returns success, never an error.
- Teardown-script failures are logged only and never block a workstream's terminal-state transition.
- No auto-restart of services that were running when the runtime last shut down, and no idle-timeout auto-teardown — only terminal-state teardown (v1 scope).
- `check_service` never accepts a caller-supplied host or port — it only ever resolves a port from the calling workstream's own service registry.
- All new/modified TypeScript files use `.js`-suffixed relative imports, matching every existing file in `packages/runtime/src/`.

---

## Task 1: Port allocator

**Files:**
- Create: `packages/runtime/src/services/port-allocator.ts`
- Test: `packages/runtime/src/services/port-allocator.test.ts`

**Interfaces:**
- Produces: `class PortAllocator { isClaimed(port: number): boolean; claim(port: number): void; release(port: number): void; allocate(range: { min: number; max: number }): Promise<number> }` and `export interface PortRange { min: number; max: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/src/services/port-allocator.test.ts
import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { PortAllocator } from './port-allocator.js';

test('allocate returns the first free port in range', async () => {
  const allocator = new PortAllocator();
  const port = await allocator.allocate({ min: 41000, max: 41005 });
  assert.ok(port >= 41000 && port <= 41005);
});

test('allocate skips already-claimed ports', async () => {
  const allocator = new PortAllocator();
  const first = await allocator.allocate({ min: 41010, max: 41015 });
  const second = await allocator.allocate({ min: 41010, max: 41015 });
  assert.notEqual(first, second);
});

test('release lets a port be claimed again', async () => {
  const allocator = new PortAllocator();
  const first = await allocator.allocate({ min: 41020, max: 41020 });
  allocator.release(first);
  const second = await allocator.allocate({ min: 41020, max: 41020 });
  assert.equal(first, second);
});

test('allocate throws when the range is exhausted', async () => {
  const allocator = new PortAllocator();
  await allocator.allocate({ min: 41030, max: 41030 });
  await assert.rejects(
    () => allocator.allocate({ min: 41030, max: 41030 }),
    /No free port in range 41030-41030/,
  );
});

test('allocate skips a port actually in use by another process', async () => {
  const blocker = net.createServer();
  await new Promise<void>((resolve) =>
    blocker.listen(41040, '127.0.0.1', resolve),
  );
  try {
    const allocator = new PortAllocator();
    const port = await allocator.allocate({ min: 41040, max: 41041 });
    assert.equal(port, 41041);
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/services/port-allocator.test.ts`
Expected: FAIL — `Cannot find module './port-allocator.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/runtime/src/services/port-allocator.ts
import net from 'node:net';

export interface PortRange {
  min: number;
  max: number;
}

/**
 * Tracks ports claimed by services across all workstreams in this runtime
 * process and finds a free port within a configured range. Claims are
 * in-memory only; they're rebuilt from workstream state files on startup by
 * ServiceManager.reconcileAll.
 */
export class PortAllocator {
  private readonly claimed = new Set<number>();

  isClaimed(port: number): boolean {
    return this.claimed.has(port);
  }

  claim(port: number): void {
    this.claimed.add(port);
  }

  release(port: number): void {
    this.claimed.delete(port);
  }

  /** Finds and claims the first free port in range, or throws. */
  async allocate(range: PortRange): Promise<number> {
    for (let port = range.min; port <= range.max; port += 1) {
      if (this.claimed.has(port)) continue;
      if (await this.isPortFree(port)) {
        this.claimed.add(port);
        return port;
      }
    }
    throw new Error(
      `No free port in range ${range.min}-${range.max} (all claimed or in use).`,
    );
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && node --import tsx --test src/services/port-allocator.test.ts`
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/services/port-allocator.ts packages/runtime/src/services/port-allocator.test.ts
git commit -m "feat(runtime): add PortAllocator for workspace services"
```

---

## Task 2: Workspace service config loader/merger

**Files:**
- Create: `packages/runtime/src/services/workspace-config.ts`
- Test: `packages/runtime/src/services/workspace-config.test.ts`

**Interfaces:**
- Produces: `interface ServiceScriptConfig { setup?: string; run: string; teardown?: string; portRange: [number, number] }`, `interface WorkspaceServicesFile { services: Record<string, ServiceScriptConfig> }`, `interface WorkspaceServicesOverrideConfig { disabled?: string[]; overrides?: Record<string, Partial<Pick<ServiceScriptConfig, 'portRange'>>> }`, `function loadWorkspaceServiceConfig(repoRoot: string): WorkspaceServicesFile | undefined`, `function resolveServiceConfig(file: WorkspaceServicesFile | undefined, name: string, override?: WorkspaceServicesOverrideConfig): ServiceScriptConfig | undefined`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/src/services/workspace-config.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  loadWorkspaceServiceConfig,
  resolveServiceConfig,
} from './workspace-config.js';

function writeConfig(repoRoot: string, content: string): void {
  const dir = path.join(repoRoot, '.artificer');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'workspace.json'), content);
}

test('loadWorkspaceServiceConfig returns undefined when the file is missing', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-wsc-'));
  assert.equal(loadWorkspaceServiceConfig(repoRoot), undefined);
});

test('loadWorkspaceServiceConfig returns undefined on invalid JSON', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-wsc-'));
  writeConfig(repoRoot, '{not json');
  assert.equal(loadWorkspaceServiceConfig(repoRoot), undefined);
});

test('loadWorkspaceServiceConfig parses a valid file', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-wsc-'));
  writeConfig(
    repoRoot,
    JSON.stringify({
      services: { web: { run: 'npm run dev', portRange: [3000, 3009] } },
    }),
  );
  const parsed = loadWorkspaceServiceConfig(repoRoot);
  assert.deepEqual(parsed?.services.web, {
    run: 'npm run dev',
    portRange: [3000, 3009],
  });
});

test('resolveServiceConfig returns undefined for an unknown name', () => {
  const file = {
    services: {
      web: { run: 'npm run dev', portRange: [3000, 3009] as [number, number] },
    },
  };
  assert.equal(resolveServiceConfig(file, 'worker'), undefined);
});

test('resolveServiceConfig returns undefined for a disabled name', () => {
  const file = {
    services: {
      web: { run: 'npm run dev', portRange: [3000, 3009] as [number, number] },
    },
  };
  assert.equal(
    resolveServiceConfig(file, 'web', { disabled: ['web'] }),
    undefined,
  );
});

test('resolveServiceConfig applies a field override', () => {
  const file = {
    services: {
      web: { run: 'npm run dev', portRange: [3000, 3009] as [number, number] },
    },
  };
  const resolved = resolveServiceConfig(file, 'web', {
    overrides: { web: { portRange: [4000, 4009] } },
  });
  assert.deepEqual(resolved, { run: 'npm run dev', portRange: [4000, 4009] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/services/workspace-config.test.ts`
Expected: FAIL — `Cannot find module './workspace-config.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/runtime/src/services/workspace-config.ts
import fs from 'node:fs';
import path from 'node:path';

export interface ServiceScriptConfig {
  setup?: string;
  run: string;
  teardown?: string;
  portRange: [number, number];
}

export interface WorkspaceServicesFile {
  services: Record<string, ServiceScriptConfig>;
}

/** The `workspaceServices` block inside artificer.config.json. */
export interface WorkspaceServicesOverrideConfig {
  disabled?: string[];
  overrides?: Record<string, Partial<Pick<ServiceScriptConfig, 'portRange'>>>;
}

/**
 * Reads `.artificer/workspace.json` from a repo root. Returns undefined if
 * the file doesn't exist or fails to parse — same fail-open pattern as
 * loadConfigDefinition in config.ts.
 */
export function loadWorkspaceServiceConfig(
  repoRoot: string,
): WorkspaceServicesFile | undefined {
  const file = path.join(repoRoot, '.artificer', 'workspace.json');
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      services?: unknown;
    };
    if (!parsed || typeof parsed !== 'object' || !parsed.services) {
      return undefined;
    }
    return parsed as WorkspaceServicesFile;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the effective config for one named service: applies the
 * identity-repo override (disable, or field overrides) on top of the
 * target-repo declaration. Returns undefined if the name is unknown or
 * disabled.
 */
export function resolveServiceConfig(
  file: WorkspaceServicesFile | undefined,
  name: string,
  override?: WorkspaceServicesOverrideConfig,
): ServiceScriptConfig | undefined {
  const base = file?.services?.[name];
  if (!base) return undefined;
  if (override?.disabled?.includes(name)) return undefined;
  const fieldOverride = override?.overrides?.[name];
  if (!fieldOverride) return base;
  return { ...base, ...fieldOverride };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && node --import tsx --test src/services/workspace-config.test.ts`
Expected: PASS — 6 tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/services/workspace-config.ts packages/runtime/src/services/workspace-config.test.ts
git commit -m "feat(runtime): add workspace service config loader"
```

---

## Task 3: Layout paths for service state and logs

**Files:**
- Modify: `packages/runtime/src/storage/layout.ts`
- Test: Create `packages/runtime/src/storage/layout.test.ts`

**Interfaces:**
- Produces: `Layout.workstreamServicesStateFile(workstreamId: string): string`, `Layout.workstreamServiceLogsDir(workstreamId: string): string`, `Layout.workstreamServiceLogFile(workstreamId: string, name: string): string`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/src/storage/layout.test.ts
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Layout } from './layout.js';

test('workstreamServicesStateFile is under the workstream workspace', () => {
  const layout = new Layout('/data');
  assert.equal(
    layout.workstreamServicesStateFile('ws1'),
    path.join('/data', 'workspace', 'ws1', '.artificer-services.json'),
  );
});

test('workstreamServiceLogFile is under the service logs dir', () => {
  const layout = new Layout('/data');
  assert.equal(
    layout.workstreamServiceLogFile('ws1', 'web'),
    path.join(
      '/data',
      'workspace',
      'ws1',
      '.artificer-service-logs',
      'web.log',
    ),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/storage/layout.test.ts`
Expected: FAIL — `layout.workstreamServicesStateFile is not a function`

- [ ] **Step 3: Add the methods to Layout**

In `packages/runtime/src/storage/layout.ts`, add after the existing `workstreamDistillHashFile` method (before the closing brace of the class):

```typescript
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
    return path.join(this.workstreamServiceLogsDir(workstreamId), `${name}.log`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && node --import tsx --test src/storage/layout.test.ts`
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/storage/layout.ts packages/runtime/src/storage/layout.test.ts
git commit -m "feat(runtime): add Layout paths for workspace service state/logs"
```

---

## Task 4: `workspaceServices` config plumbing

**Files:**
- Modify: `packages/runtime/src/api/types.ts`
- Modify: `packages/runtime/src/config.ts`
- Modify (test): `packages/runtime/src/config.test.ts`

**Interfaces:**
- Produces: `interface WorkspaceServicesConfig { disabled?: string[]; overrides?: Record<string, { portRange?: [number, number] }> }` on `ArtificerConfig.workspaceServices` and `RuntimeConfig.workspaceServices`

- [ ] **Step 1: Write the failing test**

Add to the end of `packages/runtime/src/config.test.ts`:

```typescript
test('workspaceServices passes through from artificer.config.json', () => {
  const config = mergeWithDefinition(
    {
      name: 'test',
      workspaceServices: { disabled: ['worker'] },
    },
    { LLM_API_KEY: 'test-key' },
  );
  assert.deepEqual(config.workspaceServices, { disabled: ['worker'] });
});

test('workspaceServices is undefined by default', () => {
  const config = mergeWithDefinition(
    { name: 'test' },
    { LLM_API_KEY: 'test-key' },
  );
  assert.equal(config.workspaceServices, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/config.test.ts`
Expected: FAIL — `Property 'workspaceServices' does not exist` (TypeScript) or `undefined` deepEqual mismatch once the type error is worked around; the immediate signal is a `tsx`/type-check failure since `workspaceServices` isn't a known field of `ArtificerConfig` yet.

- [ ] **Step 3: Add the type and merge logic**

In `packages/runtime/src/api/types.ts`, add near the other config interfaces (e.g. after `GitHubShorthand` or near `ExecutorConfig`):

```typescript
export interface WorkspaceServicesConfig {
  disabled?: string[];
  overrides?: Record<string, { portRange?: [number, number] }>;
}
```

Add the field to `ArtificerConfig`:

```typescript
export interface ArtificerConfig {
  name: string;
  description?: string;
  preset?: string;
  models?: Partial<ModelTiers>;
  roleTiers?: Partial<Record<RoleName, ModelTier>>;
  github?: GitHubShorthand;
  concurrency?: number;
  maxIterationsPerCall?: number;
  port?: number;
  execDir?: string;
  identity?: IdentityConfig;
  executor?: ExecutorConfig;
  quota?: QuotaConfig;
  workspaceServices?: WorkspaceServicesConfig;
}
```

In `packages/runtime/src/config.ts`, add `WorkspaceServicesConfig` to the existing type-only import from `./api/types.js`:

```typescript
import type {
  ArtificerConfig,
  ExecutorConfig,
  ResolvedIdentityConfig,
  WorkspaceServicesConfig,
} from './api/types.js';
```

Add the field to `RuntimeConfig` (after `executor?: ExecutorConfig;`):

```typescript
  /** Worker executor backend. Defaults to 'llm' (internal tool loop). */
  executor?: ExecutorConfig;
  /** Named dev-server/service scripts for worker/reviewer to start; overrides .artificer/workspace.json in the target repo. */
  workspaceServices?: WorkspaceServicesConfig;
```

In `mergeWithDefinition()`, add to the returned object (after the `executor:` line):

```typescript
    executor: definition.executor ?? base.executor,
    workspaceServices: definition.workspaceServices ?? base.workspaceServices,
    quota: definition.quota ?? base.quota,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && node --import tsx --test src/config.test.ts`
Expected: PASS — all config.test.ts tests passing, including the 2 new ones

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/api/types.ts packages/runtime/src/config.ts packages/runtime/src/config.test.ts
git commit -m "feat(runtime): add workspaceServices config field"
```

---

## Task 5: ServiceManager — start + state persistence

**Files:**
- Create: `packages/runtime/src/services/service-manager.ts`
- Test: `packages/runtime/src/services/service-manager.test.ts`

**Interfaces:**
- Consumes: `PortAllocator` (Task 1), `loadWorkspaceServiceConfig`/`resolveServiceConfig`/`ServiceScriptConfig` (Task 2), `Layout.workstreamServicesStateFile`/`workstreamServiceLogFile` (Task 3), `Store` (`store.layout`, `store.layout.workstreamWorkspace`), `findGitRepo` from `../engine/git-repo.js`, `runShellCommand` from `../tools/shell.js`
- Produces: `interface ServiceState { name: string; pid: number; port: number; startedAt: string; script: string }`, `type ServiceStartResult = { status: 'started' | 'already_running'; port: number; url: string } | { status: 'error'; message: string }`, `class ServiceManager { constructor(store: Store, config: RuntimeConfig); start(workstreamId: string, name: string): Promise<ServiceStartResult> }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/src/services/service-manager.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Store } from '../storage/store.js';
import { ServiceManager } from './service-manager.js';

async function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-svc-data-'));
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  const repoRoot = store.layout.workstreamWorkspace(ws.id);
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true }); // makes findGitRepo resolve repoRoot itself
  return { store, config, ws, repoRoot };
}

function writeServiceConfig(repoRoot: string, services: object): void {
  const dir = path.join(repoRoot, '.artificer');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workspace.json'),
    JSON.stringify({ services }),
  );
}

function longLivedScript(dir: string): string {
  const file = path.join(dir, 'long-lived.mjs');
  fs.writeFileSync(file, "setInterval(() => {}, 1000);\n");
  return file;
}

function crashingScript(dir: string): string {
  const file = path.join(dir, 'crash.mjs');
  fs.writeFileSync(file, "process.exit(1);\n");
  return file;
}

test('start spawns the run script and records state', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41100, 41109] },
  });
  const manager = new ServiceManager(store, config);
  const result = await manager.start(ws.id, 'web');
  assert.equal(result.status, 'started');
  if (result.status === 'started') {
    assert.ok(result.port >= 41100 && result.port <= 41109);
    assert.equal(result.url, `http://127.0.0.1:${result.port}`);
    process.kill(
      JSON.parse(
        fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
      )[0].pid,
      'SIGKILL',
    );
  }
});

test('start is idempotent for an already-running service', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41110, 41119] },
  });
  const manager = new ServiceManager(store, config);
  const first = await manager.start(ws.id, 'web');
  const second = await manager.start(ws.id, 'web');
  assert.equal(second.status, 'already_running');
  if (first.status === 'started' && second.status === 'already_running') {
    assert.equal(first.port, second.port);
    process.kill(
      JSON.parse(
        fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
      )[0].pid,
      'SIGKILL',
    );
  }
});

test('start reports failure when the process exits immediately', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = crashingScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41120, 41129] },
  });
  const manager = new ServiceManager(store, config);
  const result = await manager.start(ws.id, 'web');
  assert.equal(result.status, 'error');
});

test('start runs setup once before the first run', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  const marker = path.join(repoRoot, 'setup-ran.txt');
  writeServiceConfig(repoRoot, {
    web: {
      setup: `touch ${marker}`,
      run: `${process.execPath} ${script}`,
      portRange: [41130, 41139],
    },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  assert.ok(fs.existsSync(marker));
  process.kill(
    JSON.parse(
      fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
    )[0].pid,
    'SIGKILL',
  );
});

test('start returns an error for an unknown service name', async () => {
  const { store, config, ws, repoRoot } = await setup();
  writeServiceConfig(repoRoot, {});
  const manager = new ServiceManager(store, config);
  const result = await manager.start(ws.id, 'web');
  assert.equal(result.status, 'error');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/services/service-manager.test.ts`
Expected: FAIL — `Cannot find module './service-manager.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/runtime/src/services/service-manager.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && node --import tsx --test src/services/service-manager.test.ts`
Expected: PASS — 5 tests passing (allow a few seconds; the crash-detection window is 1.5s per test)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/services/service-manager.ts packages/runtime/src/services/service-manager.test.ts
git commit -m "feat(runtime): add ServiceManager.start with crash detection and setup scripts"
```

---

## Task 6: ServiceManager — stop, list, check, teardown, reconcile

**Files:**
- Modify: `packages/runtime/src/services/service-manager.ts`
- Modify (test): `packages/runtime/src/services/service-manager.test.ts`

**Interfaces:**
- Consumes: `truncateText` from `../tools/fetch-util.js`
- Produces: `stop(workstreamId, name): Promise<{ status: 'stopped' | 'already_stopped' }>`, `list(workstreamId): Promise<Array<{ name: string; port: number; status: 'running' | 'stopped' }>>`, `check(workstreamId, name): Promise<{ status: number; body: string } | { status: 'error'; message: string }>`, `teardownWorkstream(workstreamId): Promise<void>`, `reconcileAll(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/src/services/service-manager.test.ts`:

```typescript
test('stop kills the process, runs teardown, and is idempotent', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  const teardownMarker = path.join(repoRoot, 'teardown-ran.txt');
  writeServiceConfig(repoRoot, {
    web: {
      run: `${process.execPath} ${script}`,
      teardown: `touch ${teardownMarker}`,
      portRange: [41200, 41209],
    },
  });
  const manager = new ServiceManager(store, config);
  const started = await manager.start(ws.id, 'web');
  assert.equal(started.status, 'started');

  const stopped = await manager.stop(ws.id, 'web');
  assert.equal(stopped.status, 'stopped');
  assert.ok(fs.existsSync(teardownMarker));

  const stoppedAgain = await manager.stop(ws.id, 'web');
  assert.equal(stoppedAgain.status, 'already_stopped');
});

test('list reports running and stopped services', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41210, 41219] },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  const listed = await manager.list(ws.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'web');
  assert.equal(listed[0].status, 'running');
  await manager.stop(ws.id, 'web');
});

test('check fetches a running service and returns its status/body', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const serverFile = path.join(repoRoot, 'server.mjs');
  fs.writeFileSync(
    serverFile,
    "import http from 'node:http';\n" +
      "http.createServer((_, res) => res.end('ok')).listen(Number(process.env.ARTIFICER_SERVICE_PORT));\n",
  );
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${serverFile}`, portRange: [41220, 41229] },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  // Give the HTTP server a moment to bind before checking it.
  await new Promise((r) => setTimeout(r, 300));
  const result = await manager.check(ws.id, 'web');
  assert.equal((result as { status: number }).status, 200);
  assert.equal((result as { body: string }).body, 'ok');
  await manager.stop(ws.id, 'web');
});

test('check errors for a service that was never started', async () => {
  const { store, config, ws } = await setup();
  const manager = new ServiceManager(store, config);
  const result = await manager.check(ws.id, 'web');
  assert.equal(result.status, 'error');
});

test('teardownWorkstream stops every tracked service', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41230, 41239] },
    worker: { run: `${process.execPath} ${script}`, portRange: [41240, 41249] },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  await manager.start(ws.id, 'worker');
  await manager.teardownWorkstream(ws.id);
  const listed = await manager.list(ws.id);
  assert.equal(listed.length, 0);
});

test('reconcileAll drops dead entries and keeps alive ones claimed', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41250, 41259] },
  });
  const manager = new ServiceManager(store, config);
  const started = await manager.start(ws.id, 'web');
  assert.equal(started.status, 'started');

  // Simulate a dead entry alongside the live one.
  const stateFile = store.layout.workstreamServicesStateFile(ws.id);
  const states = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  states.push({
    name: 'ghost',
    pid: 999_999,
    port: 41258,
    startedAt: new Date().toISOString(),
    script: 'dead',
  });
  fs.writeFileSync(stateFile, JSON.stringify(states));

  const fresh = new ServiceManager(store, config);
  await fresh.reconcileAll();
  const listed = await fresh.list(ws.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'web');

  await fresh.stop(ws.id, 'web');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/services/service-manager.test.ts`
Expected: FAIL — `manager.stop is not a function`

- [ ] **Step 3: Add stop/list/check/teardown/reconcile to ServiceManager**

Add to the top of `packages/runtime/src/services/service-manager.ts`:

```typescript
import { truncateText } from '../tools/fetch-util.js';
```

Add `STOP_GRACE_MS` alongside `CRASH_DETECTION_MS`:

```typescript
const CRASH_DETECTION_MS = 1500;
const STOP_GRACE_MS = 5000;
```

Add these methods to the `ServiceManager` class, after `start()`:

```typescript
  async stop(
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

  async list(
    workstreamId: string,
  ): Promise<Array<{ name: string; port: number; status: 'running' | 'stopped' }>> {
    return this.readState(workstreamId).map((s) => ({
      name: s.name,
      port: s.port,
      status: isAlive(s.pid) ? ('running' as const) : ('stopped' as const),
    }));
  }

  async check(
    workstreamId: string,
    name: string,
  ): Promise<{ status: number; body: string } | { status: 'error'; message: string }> {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && node --import tsx --test src/services/service-manager.test.ts`
Expected: PASS — 11 tests passing total

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/services/service-manager.ts packages/runtime/src/services/service-manager.test.ts
git commit -m "feat(runtime): add ServiceManager stop/list/check/teardown/reconcile"
```

---

## Task 7: Expose service operations on `EngineApi` and `Engine`

**Files:**
- Modify: `packages/runtime/src/context.ts`
- Modify: `packages/runtime/src/engine/engine.ts`
- Modify (test): `packages/runtime/src/server/app.test.ts` (add one assertion using the existing `buildApp()` helper — see Step 1)

**Interfaces:**
- Consumes: `ServiceManager`, `ServiceStartResult` from `../services/service-manager.js`
- Produces: `EngineApi.startService/stopService/listServices/checkService`, `Engine.reconcileServices(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Add to `packages/runtime/src/server/app.test.ts` (after the existing imports and `buildApp` helper, as a new top-level `test(...)`):

```typescript
test('Engine exposes service operations end to end', async () => {
  const { engine, store } = await buildApp();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  const repoRoot = store.layout.workstreamWorkspace(ws.id);
  await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, '.artificer'), { recursive: true });
  const script = path.join(repoRoot, 'long-lived.mjs');
  await fs.writeFile(script, 'setInterval(() => {}, 1000);\n');
  await fs.writeFile(
    path.join(repoRoot, '.artificer', 'workspace.json'),
    JSON.stringify({
      services: {
        web: { run: `${process.execPath} ${script}`, portRange: [41300, 41309] },
      },
    }),
  );

  const started = await engine.startService(ws.id, 'web');
  assert.equal(started.status, 'started');
  const listed = await engine.listServices(ws.id);
  assert.equal(listed[0]?.status, 'running');
  const stopped = await engine.stopService(ws.id, 'web');
  assert.equal(stopped.status, 'stopped');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/server/app.test.ts`
Expected: FAIL — `engine.startService is not a function`

- [ ] **Step 3: Add the four methods to `EngineApi` and implement them on `Engine`**

In `packages/runtime/src/context.ts`, add an import and extend `EngineApi`:

```typescript
import type {
  ServiceCheckResult,
  ServiceListEntry,
  ServiceStartResult,
  ServiceStopResult,
} from './services/service-manager.js';
```

(Note: `ServiceCheckResult`, `ServiceListEntry`, and `ServiceStopResult` don't exist as named exports yet — add them to `packages/runtime/src/services/service-manager.ts` first, as type aliases for the return types already implemented in Task 6:)

```typescript
// In service-manager.ts, alongside ServiceStartResult:
export type ServiceStopResult = { status: 'stopped' | 'already_stopped' };
export interface ServiceListEntry {
  name: string;
  port: number;
  status: 'running' | 'stopped';
}
export type ServiceCheckResult =
  | { status: number; body: string }
  | { status: 'error'; message: string };
```

Then update the `stop`, `list`, and `check` method signatures in `service-manager.ts` to return these named types instead of their inline equivalents (same shapes, now named):

```typescript
  async stop(workstreamId: string, name: string): Promise<ServiceStopResult> {
```
```typescript
  async list(workstreamId: string): Promise<ServiceListEntry[]> {
```
```typescript
  async check(workstreamId: string, name: string): Promise<ServiceCheckResult> {
```

Back in `context.ts`, add to the `EngineApi` interface (after `deleteSchedule`):

```typescript
  startService(workstreamId: string, name: string): Promise<ServiceStartResult>;
  stopService(workstreamId: string, name: string): Promise<ServiceStopResult>;
  listServices(workstreamId: string): Promise<ServiceListEntry[]>;
  checkService(workstreamId: string, name: string): Promise<ServiceCheckResult>;
```

In `packages/runtime/src/engine/engine.ts`, add the import:

```typescript
import { ServiceManager } from '../services/service-manager.js';
```

Add a field alongside the other `private readonly` fields:

```typescript
  private readonly serviceManager: ServiceManager;
```

Initialize it in the constructor body (after `this.registry = registry ?? new RoleRegistry();`):

```typescript
    this.serviceManager = new ServiceManager(store, config);
```

Add the four public methods anywhere among the other public `EngineApi` method implementations (e.g. near `listSchedules`/`upsertSchedule`):

```typescript
  async startService(workstreamId: string, name: string) {
    return this.serviceManager.start(workstreamId, name);
  }

  async stopService(workstreamId: string, name: string) {
    return this.serviceManager.stop(workstreamId, name);
  }

  async listServices(workstreamId: string) {
    return this.serviceManager.list(workstreamId);
  }

  async checkService(workstreamId: string, name: string) {
    return this.serviceManager.check(workstreamId, name);
  }

  /** Reattach to services that were running before a runtime restart. */
  async reconcileServices(): Promise<void> {
    return this.serviceManager.reconcileAll();
  }
```

Modify `handleWorkstreamTerminal` to tear down services first:

```typescript
  private async handleWorkstreamTerminal(ws: Workstream): Promise<void> {
    await this.serviceManager.teardownWorkstream(ws.id).catch((err) => {
      console.error(`[services] teardown failed for workstream ${ws.id}:`, err);
    });
    if (!this.memoryService) return;
    try {
      await this.memoryService.onTerminal(ws);
      if (this.config.identity?.distillWorkstreams === false) return;
      await this.memoryService.requestDistill(ws, (input) =>
        this.spawnCall(input),
      );
    } catch (err) {
      console.error(
        `[workstream-memory] terminal handling failed for ${ws.id}:`,
        err,
      );
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && node --import tsx --test src/server/app.test.ts src/services/service-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/context.ts packages/runtime/src/engine/engine.ts packages/runtime/src/services/service-manager.ts packages/runtime/src/server/app.test.ts
git commit -m "feat(runtime): expose service operations on EngineApi, teardown on workstream terminal"
```

---

## Task 8: Reattach services at runtime startup

**Files:**
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Consumes: `Engine.reconcileServices()` (Task 7)

- [ ] **Step 1: Locate the startup sequence and add the call**

This task has no isolated unit test — `reconcileAll()` is already covered by Task 6's `service-manager.test.ts`, and `startRuntime()` itself starts an HTTP server, which is exercised by existing higher-level tests, not a new one here. Verification is a manual startup check in Step 2.

In `packages/runtime/src/index.ts`, in `startRuntime()`, add the call right before `const recovered = await engine.recoverZombieRuns();`:

```typescript
  const engine = new Engine(config, store, undefined, undefined, identity);
  await engine.reconcileServices();
  const scheduleRunner = createScheduleRunnerForEngine(engine);

  const recovered = await engine.recoverZombieRuns();
```

- [ ] **Step 2: Verify the runtime still starts cleanly**

Run: `cd packages/runtime && node --import tsx -e "import('./src/index.js').then(m => m.startRuntime())"` with a scratch `ARTIFICER_EXEC_DIR` and `LLM_API_KEY` set, e.g.:

```bash
cd packages/runtime && ARTIFICER_EXEC_DIR=/tmp/artificer-reconcile-check LLM_API_KEY=test-key PORT=0 timeout 3 node --import tsx -e "import('./src/index.js').then(m => m.startRuntime())"
```

Expected: the process starts and logs its normal startup banner (or times out after 3s with no error) — no exception thrown by `reconcileServices()` on a fresh exec dir with zero workstreams.

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/src/index.ts
git commit -m "feat(runtime): reconcile workspace services on startup"
```

---

## Task 9: `start_service`/`stop_service`/`list_services`/`check_service` tools

**Files:**
- Create: `packages/runtime/src/tools/services.ts`
- Test: `packages/runtime/src/tools/services.test.ts`
- Modify: `packages/runtime/src/tools/registry.ts`

**Interfaces:**
- Consumes: `EngineApi.startService/stopService/listServices/checkService` (Task 7)
- Produces: `function createServiceTools(ctx: ToolContext): ToolDef[]` returning tools named `start_service`, `stop_service`, `list_services`, `check_service`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/src/tools/services.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ToolContext } from '../context.js';
import { Store } from '../storage/store.js';
import { createServiceTools } from './services.js';

interface FakeCall {
  method: string;
  args: unknown[];
}

async function freshContext(
  workstreamId?: string,
): Promise<{ ctx: ToolContext; calls: FakeCall[] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-svc-tools-'));
  const store = new Store(dir);
  await store.init();
  const run = await store.createRun({ role: 'worker', task: 'test' });
  run.workstreamId = workstreamId;
  const calls: FakeCall[] = [];
  const engine = {
    store,
    async startService(workstreamId: string, name: string) {
      calls.push({ method: 'startService', args: [workstreamId, name] });
      return { status: 'started' as const, port: 4100, url: 'http://127.0.0.1:4100' };
    },
    async stopService(workstreamId: string, name: string) {
      calls.push({ method: 'stopService', args: [workstreamId, name] });
      return { status: 'stopped' as const };
    },
    async listServices(workstreamId: string) {
      calls.push({ method: 'listServices', args: [workstreamId] });
      return [{ name: 'web', port: 4100, status: 'running' as const }];
    },
    async checkService(workstreamId: string, name: string) {
      calls.push({ method: 'checkService', args: [workstreamId, name] });
      return { status: 200, body: 'ok' };
    },
  } as unknown as ToolContext['engine'];
  return { ctx: { engine, run, workspaceDir: dir }, calls };
}

test('start_service calls engine.startService with the run workstreamId', async () => {
  const { ctx, calls } = await freshContext('ws1');
  const tools = createServiceTools(ctx);
  const startTool = tools.find((t) => t.name === 'start_service')!;
  const result = await startTool.handler({ name: 'web' });
  assert.deepEqual(JSON.parse(result), {
    status: 'started',
    port: 4100,
    url: 'http://127.0.0.1:4100',
  });
  assert.deepEqual(calls, [
    { method: 'startService', args: ['ws1', 'web'] },
  ]);
});

test('stop_service, list_services, check_service delegate to engine', async () => {
  const { ctx } = await freshContext('ws1');
  const tools = createServiceTools(ctx);
  const stopResult = await tools.find((t) => t.name === 'stop_service')!.handler({
    name: 'web',
  });
  assert.deepEqual(JSON.parse(stopResult), { status: 'stopped' });

  const listResult = await tools.find((t) => t.name === 'list_services')!.handler(
    {},
  );
  assert.deepEqual(JSON.parse(listResult), [
    { name: 'web', port: 4100, status: 'running' },
  ]);

  const checkResult = await tools
    .find((t) => t.name === 'check_service')!
    .handler({ name: 'web' });
  assert.deepEqual(JSON.parse(checkResult), { status: 200, body: 'ok' });
});

test('start_service throws when the run has no workstreamId', async () => {
  const { ctx } = await freshContext(undefined);
  const tools = createServiceTools(ctx);
  const startTool = tools.find((t) => t.name === 'start_service')!;
  await assert.rejects(
    () => startTool.handler({ name: 'web' }),
    /Service tools require a workstream-scoped run/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/tools/services.test.ts`
Expected: FAIL — `Cannot find module './services.js'`

- [ ] **Step 3: Write the tool definitions**

```typescript
// packages/runtime/src/tools/services.ts
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

function requireWorkstreamId(ctx: ToolContext): string {
  const id = ctx.run.workstreamId;
  if (!id) {
    throw new Error('Service tools require a workstream-scoped run.');
  }
  return id;
}

/** Tools for the worker/reviewer roles to run and check a project's declared dev-server services. */
export function createServiceTools(ctx: ToolContext): ToolDef[] {
  const { engine } = ctx;

  return [
    {
      name: 'start_service',
      description:
        'Start a named dev-server/service declared in .artificer/workspace.json and leave it running in the background. Returns its allocated port and URL. Safe to call again for an already-running service.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            description: 'The service name from .artificer/workspace.json.',
          },
        },
      },
      handler: async (input) => {
        const result = await engine.startService(
          requireWorkstreamId(ctx),
          String(input.name ?? ''),
        );
        return JSON.stringify(result);
      },
    },
    {
      name: 'stop_service',
      description:
        'Stop a running named service and run its teardown script, if any.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      handler: async (input) => {
        const result = await engine.stopService(
          requireWorkstreamId(ctx),
          String(input.name ?? ''),
        );
        return JSON.stringify(result);
      },
    },
    {
      name: 'list_services',
      description:
        'List every service tracked on this workstream and whether it is currently running.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const result = await engine.listServices(requireWorkstreamId(ctx));
        return JSON.stringify(result);
      },
    },
    {
      name: 'check_service',
      description:
        'Fetch the root URL of a running named service and return its HTTP status and a truncated body, to verify it responds.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      handler: async (input) => {
        const result = await engine.checkService(
          requireWorkstreamId(ctx),
          String(input.name ?? ''),
        );
        return JSON.stringify(result);
      },
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && node --import tsx --test src/tools/services.test.ts`
Expected: PASS — 3 tests passing

- [ ] **Step 5: Wire the tools into `worker` and `reviewer`**

In `packages/runtime/src/tools/registry.ts`, add the import:

```typescript
import { createServiceTools } from './services.js';
```

Add the tool construction alongside the other `const x = createXTools(ctx);` lines:

```typescript
  const services = createServiceTools(ctx);
```

Add `...services` to the `reviewer` case array:

```typescript
    case 'reviewer':
      result = [
        ...byName(files, ['read_file', 'list_files']),
        ...searchAll,
        ...toolResultRead,
        ...shell,
        ...git,
        ...services,
        ...byName(artifacts, ['read_plan', 'submit_review']),
        ...byName(orchestrator, [
          'get_status',
          'query_memories',
          'record_finding',
        ]),
      ];
      break;
```

Add `...services` to the `worker` case array:

```typescript
    case 'worker':
      result = [
        ...files,
        ...edit,
        ...searchAll,
        ...toolResultRead,
        ...shell,
        ...git,
        ...services,
        ...byName(artifacts, ['read_plan', 'report_status']),
        ...byName(orchestrator, [
          'get_status',
          'query_memories',
          'add_memory',
          'record_finding',
          'update_status',
        ]),
      ];
      break;
```

- [ ] **Step 6: Run the full registry test suite to verify no regressions**

Run: `cd packages/runtime && node --import tsx --test src/tools/registry.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/tools/services.ts packages/runtime/src/tools/services.test.ts packages/runtime/src/tools/registry.ts
git commit -m "feat(runtime): add start/stop/list/check_service tools for worker and reviewer"
```

---

## Task 10: Documentation

**Files:**
- Modify: `docs/reference/config.md`
- Modify: `docs/reference/roles.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Document `.artificer/workspace.json` and `workspaceServices` in `docs/reference/config.md`**

Add a new section after the existing `### executor block` section:

```markdown
### `.artificer/workspace.json` (target repo) and `workspaceServices` override

Projects can declare named, long-lived dev-server scripts in a `.artificer/workspace.json` file committed at the root of the *target* repo (not the identity repo) — the same file whether a human or Artificer runs the project:

\```json
{
  "services": {
    "web": {
      "setup": "npm install",
      "run": "npm run dev",
      "teardown": "",
      "portRange": [3000, 3009]
    }
  }
}
\```

| Field | Required | Description |
|---|---|---|
| `setup` | No | Runs once per workstream, before the first `run`. A non-zero exit aborts before `run` ever executes. |
| `run` | Yes | The long-lived process. Spawned detached so it survives a runtime restart. |
| `teardown` | No | Runs once after the process is stopped. Failures are logged only. |
| `portRange` | Yes | `[min, max]` inclusive. The runtime allocates the next free port in this range. |

The `worker` and `reviewer` roles start/stop/list/check these by name with the `start_service`, `stop_service`, `list_services`, and `check_service` tools (see [Roles reference](./roles.md)). Every `setup`/`run`/`teardown` invocation gets `ARTIFICER_SERVICE_NAME`, `ARTIFICER_SERVICE_PORT`, `ARTIFICER_SERVICE_URL` (`http://127.0.0.1:<port>`), and `ARTIFICER_WORKSPACE_DIR` in its environment.

An identity repo can disable or override a target repo's declared services via `artificer.config.json`:

\```jsonc
{
  "workspaceServices": {
    "disabled": ["worker"],
    "overrides": {
      "web": { "portRange": [4000, 4009] }
    }
  }
}
\```

`disabled` removes a named service from the tool-visible set entirely. `overrides` merges field-by-field onto the target repo's declaration for that name — today only `portRange` is supported.
```

- [ ] **Step 2: Add the four tools to the Worker and Reviewer sections in `docs/reference/roles.md`**

In the `## Worker` section's **Tools available** list, add after `update_status`:

```markdown
- `start_service` — start a named dev-server/service from `.artificer/workspace.json`, returning its port and URL
- `stop_service` — stop a running named service and run its teardown script
- `list_services` — list every service tracked on this workstream and its running/stopped state
- `check_service` — fetch a running service's root URL and return its HTTP status and a truncated body
```

In the `## Reviewer` section's **Tools available** list, add after `record_finding`:

```markdown
- `start_service` — start a named dev-server/service from `.artificer/workspace.json`, returning its port and URL
- `stop_service` — stop a running named service and run its teardown script
- `list_services` — list every service tracked on this workstream and its running/stopped state
- `check_service` — fetch a running service's root URL and return its HTTP status and a truncated body
```

In the **Tool access summary** table, add four new rows (or four new columns filled in for `worker`/`reviewer` only) for `start_service`, `stop_service`, `list_services`, `check_service`, each marked `yes` under `worker` and `reviewer` and blank under every other role.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/config.md docs/reference/roles.md
git commit -m "docs: document workspace service scripts and their tools"
```

---

## Task 11: Full verification pass

**Files:** None — verification only.

- [ ] **Step 1: Run the full runtime test suite**

Run: `pnpm --filter @artificer-ai/runtime test`
Expected: PASS, including every test added in Tasks 1–9

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @artificer-ai/runtime type-check`
Expected: no errors

- [ ] **Step 3: Lint**

Run: `pnpm --filter @artificer-ai/runtime lint`
Expected: no errors (run `pnpm --filter @artificer-ai/runtime lint -- --write` equivalent, i.e. `prettier --write`, if formatting drifted, then re-run `lint` to confirm clean)

- [ ] **Step 4: Manual smoke test**

In a scratch scaffolded agent project (`artificer init`), add a trivial `.artificer/workspace.json` (e.g. `{ "services": { "web": { "run": "python3 -m http.server $ARTIFICER_SERVICE_PORT", "portRange": [3500, 3509] } } }`) to a real cloned test repo, run `artificer dev`, trigger a workstream, and manually verify via the API (`POST` a worker-role tool call, or inspect logs) that `start_service` returns a real port and `check_service` gets a 200. This is the one step this plan cannot fully automate — it exercises the real HTTP server, real git clone, and real workstream FSM together.

- [ ] **Step 5: Commit (only if Steps 1-3 required fixes)**

```bash
git add -A
git commit -m "fix(runtime): address lint/type-check findings from workspace services verification"
```
