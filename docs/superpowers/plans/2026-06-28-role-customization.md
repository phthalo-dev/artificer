# Role Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow identity code to define, override, and fully author roles via `agent/roles/<slug>.md` files, with frontmatter controlling the role name, blurb, and which built-in tool set to inherit.

**Architecture:** A new `RoleRegistry` class seeds from the 6 built-in role definitions and merges identity-provided roles (overrides replace built-ins by slug, new slugs add custom roles). `Engine` holds the registry and passes it into `executeCall`, which resolves the effective base role for tool selection and context injection. `agent/instructions.md` (already loaded but unused) is wired as `globalInstructions` appended to every role's system prompt.

**Tech Stack:** TypeScript, Node.js built-in test runner (`node:test`), `tsx` for test transpilation.

## Global Constraints

- Test runner: `node --import tsx --test "src/**/*.test.ts"` from `packages/runtime/`
- Single test file: `node --import tsx --test src/path/to/file.test.ts`
- No mocking of the LLM; engine-level tests stay structural
- `RoleName` type union is preserved (used for config tier lookups); only storage/call sites widen to `string`
- `{{agentName}}` substitution happens at call time, not at load time

---

## File Map

**Created:**
- `packages/runtime/src/engine/role-registry.ts` — `RoleRegistry` class
- `packages/runtime/src/engine/role-registry.test.ts` — unit tests

**Modified:**
- `packages/runtime/src/storage/types.ts` — widen `Task.role`, `Finding.role`, `RunRecord.role` to `string`
- `packages/runtime/src/engine/roles.ts` — widen `RoleDefinition.name` to `string`, add `baseRole?: string`
- `packages/runtime/src/context.ts` — widen `SpawnCallInput.role` to `string`, add `listRoles()` to `EngineApi`
- `packages/runtime/src/discover/discover.ts` — add `roles: ModuleRef[]` to `AgentManifest`
- `packages/runtime/src/discover/loader.ts` — add `IdentityRole` interface and `loadRolesFromDisk`
- `packages/runtime/src/discover/loader.test.ts` — add `loadRolesFromDisk` tests
- `packages/runtime/src/config.ts` — add `globalInstructions?: string` to `RuntimeConfig`
- `packages/runtime/src/tools/registry.ts` — widen `toolsForRole` role param to `string`
- `packages/runtime/src/engine/call.ts` — use registry, resolve effectiveBaseRole, compose system prompt
- `packages/runtime/src/engine/engine.ts` — accept `RoleRegistry` in constructor, implement `listRoles()`
- `packages/runtime/src/tools/orchestrator-tool.ts` — dynamic role validation via `engine.listRoles()`
- `packages/runtime/src/api/create-runtime.ts` — load identity roles, construct registry, wire globalInstructions
- `packages/runtime/src/engine/engine.test.ts` — add registry integration test

---

## Task 1: Widen role types and extend discover manifest

**Files:**
- Modify: `packages/runtime/src/storage/types.ts`
- Modify: `packages/runtime/src/engine/roles.ts`
- Modify: `packages/runtime/src/context.ts`
- Modify: `packages/runtime/src/discover/discover.ts`

**Interfaces:**
- Produces: `RunRecord.role: string`, `Task.role: string`, `Finding.role: string`, `SpawnCallInput.role: string`, `RoleDefinition.name: string`, `RoleDefinition.baseRole?: string`, `AgentManifest.roles: ModuleRef[]`

- [ ] **Step 1: Widen role fields in storage/types.ts**

In `packages/runtime/src/storage/types.ts`, change the three `role: RoleName` fields to `role: string`:

```typescript
// Task interface (around line 51)
export interface Task {
  id: string;
  workstreamId: string;
  role: string;   // was: RoleName
  // ...
}

// Finding interface (around line 89)
export interface Finding {
  id: string;
  workstreamId: string;
  role: string;   // was: RoleName
  // ...
}

// RunRecord interface (around line 130)
export interface RunRecord {
  id: string;
  role: string;   // was: RoleName
  // ...
}
```

- [ ] **Step 2: Extend RoleDefinition in engine/roles.ts**

In `packages/runtime/src/engine/roles.ts`, update the `RoleDefinition` interface:

```typescript
export interface RoleDefinition {
  name: string;         // was: RoleName
  blurb: string;
  baseRole?: string;    // new: which built-in's tool set to inherit; absent = own slug
  system: (agentName: string) => string;
}
```

No other changes to `roles.ts` — all 6 built-in definitions stay identical.

- [ ] **Step 3: Widen SpawnCallInput.role in context.ts**

In `packages/runtime/src/context.ts`, change:

```typescript
export interface SpawnCallInput {
  role: string;   // was: RoleName
  description: string;
  workstreamId?: string;
  parentRunId?: string;
  originMessageId?: string;
  complexity?: ModelTier;
}
```

Also remove the `RoleName` import from `./storage/types.js` if it is no longer used in this file (it was only used for `SpawnCallInput.role`). Check the file — `RoleName` may still be imported for other uses; only remove if truly unused.

- [ ] **Step 4: Add roles field to AgentManifest in discover/discover.ts**

In `packages/runtime/src/discover/discover.ts`:

```typescript
export interface AgentManifest {
  config?: ModuleRef;
  instructions?: ModuleRef;
  tools: ModuleRef[];
  channels: ModuleRef[];
  skills: ModuleRef[];
  memories: ModuleRef[];
  roles: ModuleRef[];   // new
}
```

In `scanAgentDirectory`, initialize `manifest.roles` and populate it:

```typescript
// Inside scanAgentDirectory, after the skills line:
manifest.roles = listByExt(path.join(rootDir, 'agent', 'roles'), '.md');
```

And in the initial `manifest` object:

```typescript
const manifest: AgentManifest = {
  tools: [],
  channels: [],
  skills: [],
  memories: [],
  roles: [],   // new
};
```

- [ ] **Step 5: Run existing tests to verify no runtime breakage**

```bash
cd packages/runtime && npm test
```

Expected: all existing tests pass. TSX strips types so widening `RoleName` → `string` produces no runtime errors.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/storage/types.ts \
        packages/runtime/src/engine/roles.ts \
        packages/runtime/src/context.ts \
        packages/runtime/src/discover/discover.ts
git commit -m "feat(runtime): widen role types to string and scan agent/roles directory"
```

---

## Task 2: loadRolesFromDisk

**Files:**
- Modify: `packages/runtime/src/discover/loader.ts`
- Modify: `packages/runtime/src/discover/loader.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface IdentityRole {
    slug: string;       // filename without .md (used as registry key)
    name: string;       // from frontmatter "name:" or defaults to slug
    blurb: string;      // from frontmatter "blurb:" or defaults to ''
    baseRole: string;   // from frontmatter "baseRole:" or defaults to 'worker'
    systemTemplate: string;  // body text; {{agentName}} not yet substituted
  }
  export function loadRolesFromDisk(refs: ModuleRef[]): IdentityRole[]
  ```

- [ ] **Step 1: Write failing tests in loader.test.ts**

Add a new `describe('loadRolesFromDisk')` block at the end of `packages/runtime/src/discover/loader.test.ts`:

```typescript
import { loadRolesFromDisk } from './loader.js';

describe('loadRolesFromDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-roles-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses name, blurb, and baseRole from frontmatter', () => {
    const p = path.join(tmpDir, 'auditor.md');
    fs.writeFileSync(p, '---\nname: Security Auditor\nblurb: Finds bugs.\nbaseRole: reviewer\n---\n\nYou are {{agentName}}.');
    const roles = loadRolesFromDisk([{ name: 'auditor', path: p }]);
    assert.equal(roles.length, 1);
    assert.equal(roles[0].slug, 'auditor');
    assert.equal(roles[0].name, 'Security Auditor');
    assert.equal(roles[0].blurb, 'Finds bugs.');
    assert.equal(roles[0].baseRole, 'reviewer');
    assert.equal(roles[0].systemTemplate, 'You are {{agentName}}.');
  });

  it('preserves {{agentName}} in systemTemplate without substituting it', () => {
    const p = path.join(tmpDir, 'helper.md');
    fs.writeFileSync(p, '---\nname: Helper\n---\n\nYou are {{agentName}}\'s helper.');
    const roles = loadRolesFromDisk([{ name: 'helper', path: p }]);
    assert.ok(roles[0].systemTemplate.includes('{{agentName}}'));
    assert.ok(!roles[0].systemTemplate.includes('undefined'));
  });

  it('uses defaults when frontmatter fields are absent', () => {
    const p = path.join(tmpDir, 'my-role.md');
    fs.writeFileSync(p, '---\n---\n\nDo stuff.');
    const roles = loadRolesFromDisk([{ name: 'my-role', path: p }]);
    assert.equal(roles[0].slug, 'my-role');
    assert.equal(roles[0].name, 'my-role');
    assert.equal(roles[0].blurb, '');
    assert.equal(roles[0].baseRole, 'worker');
    assert.equal(roles[0].systemTemplate, 'Do stuff.');
  });

  it('falls back to worker for an unknown baseRole and warns', () => {
    const p = path.join(tmpDir, 'weird.md');
    fs.writeFileSync(p, '---\nbaseRole: nonexistent\n---\n\nBody.');
    // suppress warning output in test
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    const roles = loadRolesFromDisk([{ name: 'weird', path: p }]);
    console.warn = warn;
    assert.equal(roles[0].baseRole, 'worker');
    assert.ok(warnings.some((w) => w.includes('nonexistent')));
  });

  it('handles body-only files with no frontmatter delimiters', () => {
    const p = path.join(tmpDir, 'plain.md');
    fs.writeFileSync(p, 'Just a plain body with no frontmatter.');
    const roles = loadRolesFromDisk([{ name: 'plain', path: p }]);
    assert.equal(roles[0].name, 'plain');
    assert.equal(roles[0].baseRole, 'worker');
    assert.equal(roles[0].systemTemplate, 'Just a plain body with no frontmatter.');
  });

  it('skips unreadable files without throwing', () => {
    const roles = loadRolesFromDisk([{ name: 'missing', path: '/nonexistent/path.md' }]);
    assert.equal(roles.length, 0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/runtime && node --import tsx --test src/discover/loader.test.ts
```

Expected: the 6 new `loadRolesFromDisk` tests fail with "loadRolesFromDisk is not a function" or similar.

- [ ] **Step 3: Implement loadRolesFromDisk in loader.ts**

Add to `packages/runtime/src/discover/loader.ts` (after existing exports):

```typescript
export interface IdentityRole {
  slug: string;
  name: string;
  blurb: string;
  baseRole: string;
  systemTemplate: string;
}

const VALID_BASE_ROLES = new Set([
  'communicator',
  'orchestrator',
  'planner',
  'worker',
  'reviewer',
  'librarian',
]);

function parseRoleFrontmatter(raw: string): {
  fm: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw.trim() };
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }
  return { fm, body: match[2].trim() };
}

export function loadRolesFromDisk(refs: ModuleRef[]): IdentityRole[] {
  const roles: IdentityRole[] = [];
  for (const ref of refs) {
    try {
      const raw = fs.readFileSync(ref.path, 'utf-8');
      const { fm, body } = parseRoleFrontmatter(raw);
      let baseRole = fm.baseRole ?? 'worker';
      if (!VALID_BASE_ROLES.has(baseRole)) {
        console.warn(
          `[artificer] role "${ref.name}": unknown baseRole "${baseRole}", falling back to "worker"`,
        );
        baseRole = 'worker';
      }
      roles.push({
        slug: ref.name,
        name: fm.name ?? ref.name,
        blurb: fm.blurb ?? '',
        baseRole,
        systemTemplate: body,
      });
    } catch {
      console.warn(`[artificer] failed to load role file "${ref.path}"`);
    }
  }
  return roles;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd packages/runtime && node --import tsx --test src/discover/loader.test.ts
```

Expected: all 6 new tests pass plus the existing `loadSkillsFromDisk` and `loadInstructionsFromDisk` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/discover/loader.ts \
        packages/runtime/src/discover/loader.test.ts
git commit -m "feat(runtime): add loadRolesFromDisk to discover/loader"
```

---

## Task 3: RoleRegistry

**Files:**
- Create: `packages/runtime/src/engine/role-registry.ts`
- Create: `packages/runtime/src/engine/role-registry.test.ts`

**Interfaces:**
- Consumes: `IdentityRole` from `../discover/loader.js`, `RoleDefinition` and `getRole` from `./roles.js`
- Produces:
  ```typescript
  export class RoleRegistry {
    constructor(identityRoles?: IdentityRole[])
    getRole(name: string): RoleDefinition | undefined
    listRoleNames(): string[]
  }
  ```

- [ ] **Step 1: Write failing tests in role-registry.test.ts**

Create `packages/runtime/src/engine/role-registry.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoleRegistry } from './role-registry.js';
import type { IdentityRole } from '../discover/loader.js';

describe('RoleRegistry', () => {
  it('contains all 6 built-in roles with no identity roles', () => {
    const registry = new RoleRegistry();
    for (const name of ['communicator', 'orchestrator', 'planner', 'worker', 'reviewer', 'librarian']) {
      assert.ok(registry.getRole(name), `missing built-in role: ${name}`);
    }
  });

  it('built-in role system prompt includes agentName substitution', () => {
    const registry = new RoleRegistry();
    const worker = registry.getRole('worker')!;
    const prompt = worker.system('TestBot');
    assert.ok(prompt.includes('TestBot'), 'system prompt should include agent name');
  });

  it('identity role overrides a built-in by slug', () => {
    const ir: IdentityRole = {
      slug: 'worker',
      name: 'Custom Worker',
      blurb: 'Does custom work.',
      baseRole: 'worker',
      systemTemplate: 'You are {{agentName}} custom worker.',
    };
    const registry = new RoleRegistry([ir]);
    const worker = registry.getRole('worker')!;
    assert.equal(worker.name, 'Custom Worker');
    assert.equal(worker.blurb, 'Does custom work.');
    assert.equal(worker.system('Hal'), 'You are Hal custom worker.');
  });

  it('identity role adds a new slug not in built-ins', () => {
    const ir: IdentityRole = {
      slug: 'security-auditor',
      name: 'Security Auditor',
      blurb: 'Finds bugs.',
      baseRole: 'reviewer',
      systemTemplate: 'You are {{agentName}} auditor.',
    };
    const registry = new RoleRegistry([ir]);
    const auditor = registry.getRole('security-auditor')!;
    assert.ok(auditor, 'custom role should be registered');
    assert.equal(auditor.baseRole, 'reviewer');
    assert.equal(auditor.system('Hal'), 'You are Hal auditor.');
  });

  it('new role has correct baseRole from identity', () => {
    const ir: IdentityRole = {
      slug: 'analyst',
      name: 'Analyst',
      blurb: '',
      baseRole: 'planner',
      systemTemplate: 'Analyse.',
    };
    const registry = new RoleRegistry([ir]);
    assert.equal(registry.getRole('analyst')!.baseRole, 'planner');
  });

  it('getRole returns undefined for unknown names', () => {
    const registry = new RoleRegistry();
    assert.equal(registry.getRole('nonexistent'), undefined);
  });

  it('listRoleNames includes all built-ins', () => {
    const registry = new RoleRegistry();
    const names = registry.listRoleNames();
    for (const n of ['communicator', 'orchestrator', 'planner', 'worker', 'reviewer', 'librarian']) {
      assert.ok(names.includes(n), `${n} missing from listRoleNames`);
    }
  });

  it('listRoleNames includes custom roles', () => {
    const ir: IdentityRole = {
      slug: 'security-auditor',
      name: 'Security Auditor',
      blurb: '',
      baseRole: 'reviewer',
      systemTemplate: '',
    };
    const registry = new RoleRegistry([ir]);
    assert.ok(registry.listRoleNames().includes('security-auditor'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/runtime && node --import tsx --test src/engine/role-registry.test.ts
```

Expected: all tests fail with "Cannot find module './role-registry.js'" or similar.

- [ ] **Step 3: Implement RoleRegistry**

Create `packages/runtime/src/engine/role-registry.ts`:

```typescript
import type { IdentityRole } from '../discover/loader.js';
import type { RoleDefinition } from './roles.js';
import { getRole as getBuiltinRole } from './roles.js';

const BUILT_IN_NAMES = [
  'communicator',
  'orchestrator',
  'planner',
  'worker',
  'reviewer',
  'librarian',
] as const;

export class RoleRegistry {
  private readonly roles = new Map<string, RoleDefinition>();

  constructor(identityRoles: IdentityRole[] = []) {
    for (const name of BUILT_IN_NAMES) {
      this.roles.set(name, getBuiltinRole(name));
    }
    for (const ir of identityRoles) {
      const template = ir.systemTemplate;
      this.roles.set(ir.slug, {
        name: ir.name,
        blurb: ir.blurb,
        baseRole: ir.baseRole,
        system: (agentName: string) =>
          template.replace(/\{\{agentName\}\}/g, agentName),
      });
    }
  }

  getRole(name: string): RoleDefinition | undefined {
    return this.roles.get(name);
  }

  listRoleNames(): string[] {
    return [...this.roles.keys()];
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd packages/runtime && node --import tsx --test src/engine/role-registry.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/role-registry.ts \
        packages/runtime/src/engine/role-registry.test.ts
git commit -m "feat(runtime): add RoleRegistry"
```

---

## Task 4: Wire RoleRegistry and globalInstructions into Engine and call.ts

**Files:**
- Modify: `packages/runtime/src/config.ts`
- Modify: `packages/runtime/src/tools/registry.ts`
- Modify: `packages/runtime/src/engine/call.ts`
- Modify: `packages/runtime/src/engine/engine.ts`

**Interfaces:**
- Consumes: `RoleRegistry` from `./role-registry.js`
- Produces: `RuntimeConfig.globalInstructions?: string`; `toolsForRole(role: string, ...)` (widened param); `ExecuteCallDeps.registry: RoleRegistry`; `Engine` constructor accepts optional `RoleRegistry`

- [ ] **Step 1: Add globalInstructions to RuntimeConfig in config.ts**

In `packages/runtime/src/config.ts`, add to the `RuntimeConfig` interface:

```typescript
export interface RuntimeConfig {
  // ... existing fields ...
  /** Global instruction suffix appended to every role's system prompt. From agent/instructions.md. */
  globalInstructions?: string;
}
```

No default value needed — it's optional and absent by default.

- [ ] **Step 2: Widen toolsForRole role parameter in tools/registry.ts**

In `packages/runtime/src/tools/registry.ts`, change the function signature from `role: RoleName` to `role: string`:

```typescript
export function toolsForRole(
  role: string,          // was: RoleName
  ctx: ToolContext,
  customRegistry?: ToolRegistry,
): ToolDef[] {
```

The `switch (role)` block inside is unchanged — it compares string literals and the default case returns `[]`. Remove the `RoleName` import from `../storage/types.js` if it is now unused in this file (check for other uses first).

- [ ] **Step 3: Update ExecuteCallDeps in call.ts**

In `packages/runtime/src/engine/call.ts`, add the registry import and field:

```typescript
import { RoleRegistry } from './role-registry.js';
```

Remove the static `getRole` import from `./roles.js` — it is replaced by `deps.registry.getRole`.

Add `registry` to `ExecuteCallDeps`:

```typescript
export interface ExecuteCallDeps {
  resolveModel: (modelId: string) => LanguageModel;
  config: RuntimeConfig;
  store: Store;
  engine: EngineApi;
  executor?: WorkerExecutor;
  registry: RoleRegistry;   // new
}
```

- [ ] **Step 4: Update executeCall to use registry and compose system prompt**

In the `executeCall` function in `call.ts`, replace the two lines:

```typescript
const tools = toolsForRole(run.role, ctx);
const role = getRole(run.role);
```

with:

```typescript
const roleDef = deps.registry.getRole(run.role);
if (!roleDef) throw new Error(`Unknown role: '${run.role}'`);
const effectiveBaseRole = roleDef.baseRole ?? run.role;
const tools = toolsForRole(effectiveBaseRole, ctx);
```

Replace `role.system(config.agentName)` in the `runToolLoop` call with a composed system string. Find the call to `runToolLoop` and change its `system:` property:

```typescript
const system = config.globalInstructions
  ? `${roleDef.system(config.agentName)}\n\n${config.globalInstructions}`
  : roleDef.system(config.agentName);

const result = await runToolLoop({
  model: resolveModel(run.model ?? config.model),
  system,   // was: role.system(config.agentName)
  // ... rest unchanged
});
```

Also update the two `WORK_ROLES.has(run.role)` calls and the `run.role === 'reviewer'` check in `buildContext`, and the `run.role === 'planner'` / `run.role === 'reviewer'` checks in `executeCall`:

In `buildContext`, add an `effectiveBaseRole` parameter:

```typescript
async function buildContext(
  store: Store,
  run: RunRecord,
  workspaceDir: string,
  config: RuntimeConfig,
  effectiveBaseRole: string,   // new parameter
): Promise<string> {
```

And replace `WORK_ROLES.has(run.role)` with `WORK_ROLES.has(effectiveBaseRole)`, and `run.role === 'reviewer'` with `effectiveBaseRole === 'reviewer'`.

In `executeCall`, pass `effectiveBaseRole` when calling `buildContext`:

```typescript
const userMessage = await buildContext(store, run, workspaceDir, config, effectiveBaseRole);
```

Replace the executor check `WORK_ROLES.has(run.role)` with `WORK_ROLES.has(effectiveBaseRole)`.

Replace the planner-specific checks `run.role === 'planner'` with `effectiveBaseRole === 'planner'`:

```typescript
const maxIterations =
  effectiveBaseRole === 'planner'   // was: run.role === 'planner'
    ? Math.min(config.maxPlannerIterations, config.maxIterationsPerCall)
    : config.maxIterationsPerCall;
// ...
maxTokens: effectiveBaseRole === 'planner' ? 8192 : 4096,   // was: run.role === 'planner'
```

- [ ] **Step 5: Add RoleRegistry field to Engine and pass it into executeCall**

In `packages/runtime/src/engine/engine.ts`, add the import:

```typescript
import { RoleRegistry } from './role-registry.js';
```

Add the `registry` field to `Engine`:

```typescript
export class Engine implements EngineApi {
  readonly store: Store;
  readonly config: RuntimeConfig;
  private readonly scheduler: Scheduler;
  private readonly events = new EventEmitter();
  private readonly active = new Map<string, ActiveRun>();
  private readonly memoryService?: WorkstreamMemoryService;
  private readonly executor?: WorkerExecutor;
  private readonly registry: RoleRegistry;   // new
  private readonly balanceNotified = new Set<string>();
```

Update the constructor signature to accept an optional `RoleRegistry`:

```typescript
constructor(
  config: RuntimeConfig,
  store: Store,
  memoryService?: WorkstreamMemoryService,
  registry?: RoleRegistry,   // new optional param
) {
  this.config = config;
  this.store = store;
  this.memoryService = memoryService;
  this.registry = registry ?? new RoleRegistry();   // new
  this.executor = buildExecutor(config.executor);
  this.scheduler = new Scheduler(config.concurrency, (runId) =>
    this.runOne(runId),
  );
}
```

In the `runOne` method, add `registry` to the `executeCall` deps object:

```typescript
const finished = await executeCall(run, {
  resolveModel: this.resolveModel,
  config: this.config,
  store: this.store,
  engine: this,
  executor: this.executor,
  registry: this.registry,   // new
});
```

- [ ] **Step 6: Run all existing tests to verify no breakage**

```bash
cd packages/runtime && npm test
```

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/config.ts \
        packages/runtime/src/tools/registry.ts \
        packages/runtime/src/engine/call.ts \
        packages/runtime/src/engine/engine.ts
git commit -m "feat(runtime): wire RoleRegistry and globalInstructions into engine call execution"
```

---

## Task 5: Dynamic invoke_call validation and create-runtime wiring

**Files:**
- Modify: `packages/runtime/src/context.ts`
- Modify: `packages/runtime/src/engine/engine.ts`
- Modify: `packages/runtime/src/tools/orchestrator-tool.ts`
- Modify: `packages/runtime/src/api/create-runtime.ts`
- Modify: `packages/runtime/src/engine/engine.test.ts`

**Interfaces:**
- Consumes: `RoleRegistry` from `./role-registry.js`, `loadRolesFromDisk` from `../discover/loader.js`
- Produces: `EngineApi.listRoles(): string[]`; `Engine` implements `listRoles()`; `invoke_call` validates against `engine.listRoles()`; `create-runtime.ts` loads identity roles and wires globalInstructions

- [ ] **Step 1: Write failing integration test in engine.test.ts**

Add to `packages/runtime/src/engine/engine.test.ts` (after existing imports, add the `RoleRegistry` import):

```typescript
import { RoleRegistry } from './role-registry.js';
import type { IdentityRole } from '../discover/loader.js';
```

Add the following test at the end of the file:

```typescript
test('Engine.listRoles includes built-ins and custom roles from registry', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-engine-roles-'));
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();

  const customRole: IdentityRole = {
    slug: 'security-auditor',
    name: 'Security Auditor',
    blurb: 'Finds bugs.',
    baseRole: 'reviewer',
    systemTemplate: 'You are {{agentName}} auditor.',
  };
  const registry = new RoleRegistry([customRole]);
  const engine = new Engine(config, store, undefined, registry);

  const roles = engine.listRoles();
  assert.ok(roles.includes('worker'), 'should include built-in worker');
  assert.ok(roles.includes('security-auditor'), 'should include custom role');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/runtime && node --import tsx --test src/engine/engine.test.ts
```

Expected: the new test fails with "engine.listRoles is not a function".

- [ ] **Step 3: Add listRoles() to EngineApi in context.ts**

In `packages/runtime/src/context.ts`, add `listRoles()` to the `EngineApi` interface:

```typescript
export interface EngineApi {
  readonly store: Store;
  readonly config: RuntimeConfig;
  spawnCall(input: SpawnCallInput): Promise<{ runId: string; taskId?: string }>;
  startWorkstream(input: {
    title: string;
    goal: string;
    repoUrl?: string;
    baseCommit?: string;
    parentRunId?: string;
    originMessageId?: string;
  }): Promise<Workstream>;
  reply(content: string, workstreamId?: string): Promise<void>;
  emit(event: RuntimeEvent): void;
  listRoles(): string[];   // new
}
```

- [ ] **Step 4: Implement listRoles() in Engine**

In `packages/runtime/src/engine/engine.ts`, add the `listRoles` method to the `Engine` class (alongside the other `EngineApi` methods):

```typescript
listRoles(): string[] {
  return this.registry.listRoleNames();
}
```

- [ ] **Step 5: Run the integration test to verify it passes**

```bash
cd packages/runtime && node --import tsx --test src/engine/engine.test.ts
```

Expected: the new test and all existing engine tests pass.

- [ ] **Step 6: Update invoke_call in orchestrator-tool.ts**

In `packages/runtime/src/tools/orchestrator-tool.ts`, remove the `SPAWNABLE_ROLES` constant:

```typescript
// Remove this line:
const SPAWNABLE_ROLES: RoleName[] = ['planner', 'reviewer', 'worker', 'orchestrator'];
```

Also remove the `RoleName` import if it is now unused.

In the `invoke_call` tool definition, change the `role` property in the input schema from an enum to a plain string:

```typescript
role: {
  type: 'string',
  description:
    'The role of the call to spawn. Built-in roles: planner, worker, reviewer, orchestrator. Custom roles defined in agent/roles/ are also available.',
},
```

In the `handler` function, replace the static validation with dynamic validation via `engine.listRoles()`:

```typescript
handler: async (input) => {
  const role = String(input.role);
  const availableRoles = engine.listRoles();
  if (!availableRoles.includes(role)) {
    return `Error: unknown role "${role}". Available roles: ${availableRoles.join(', ')}.`;
  }
  // ... rest of handler unchanged (remove the `as RoleName` cast) ...
```

The rest of the handler body (planner spawn check, reviewer spawn check, git repo check, `engine.spawnCall`) is unchanged except remove the `as RoleName` cast from `const role = String(input.role) as RoleName`.

- [ ] **Step 7: Wire everything in create-runtime.ts**

In `packages/runtime/src/api/create-runtime.ts`, add imports:

```typescript
import { loadRolesFromDisk } from '../discover/loader.js';
import { RoleRegistry } from '../engine/role-registry.js';
```

In the `createRuntime` function, after `scanAgentDirectory` and before constructing `config`, add:

```typescript
const identityRoles = loadRolesFromDisk(manifest.roles);
const registry = new RoleRegistry(identityRoles);
```

The `instructions` variable is already loaded in `create-runtime.ts` (`loadInstructionsFromDisk`) and returned on `ArtificerRuntime.instructions`. Reuse it for `globalInstructions` in the config — do NOT remove or redeclare it:

```typescript
// existing line stays:
const instructions = manifest.instructions
  ? loadInstructionsFromDisk(manifest.instructions.path)
  : null;

// Add globalInstructions when building config:
const config: RuntimeConfig = {
  ...baseConfig,
  ...options.config,
  agentName,
  execDir,
  identityDir: rootDir,
  globalInstructions: instructions?.content ?? undefined,   // new — reuses existing variable
} as RuntimeConfig;
```

Pass `registry` to the `Engine` constructor:

```typescript
const engine = new Engine(config, store, memoryService, registry);   // add registry
```

The existing `instructions: instructions?.content ?? null` in the return object is unchanged.

- [ ] **Step 8: Run all tests**

```bash
cd packages/runtime && npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/runtime/src/context.ts \
        packages/runtime/src/engine/engine.ts \
        packages/runtime/src/tools/orchestrator-tool.ts \
        packages/runtime/src/api/create-runtime.ts \
        packages/runtime/src/engine/engine.test.ts
git commit -m "feat(runtime): wire dynamic role validation, globalInstructions, and identity role loading"
```
