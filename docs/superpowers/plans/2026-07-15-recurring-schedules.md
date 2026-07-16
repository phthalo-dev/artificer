# Recurring Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users and the agent define recurring heartbeats and maintenance jobs as `agent/schedules/*.md` files, run them via a ScheduleRunner, and periodically pull identity from origin so humans can override on GitHub.

**Architecture:** Markdown schedule definitions (frontmatter + body) live in the identity repo. A polling `ScheduleRunner` evaluates due times (`every` or cron+timezone), skips overlap, and fires into `receiveMessage` or `createDirectWorkstream`. Last-fired state persists in the runtime data store. Agent tools mutate schedule files; a separate identity pull timer keeps origin in sync.

**Tech Stack:** TypeScript, Node.js built-in test runner (`node:test`), `tsx`, existing Hono/runtime patterns. No new npm dependencies — cron matching uses timezone wall-clock parts via `Intl.DateTimeFormat`.

## Global Constraints

- Test runner: `node --import tsx --test "src/**/*.test.ts"` from `packages/runtime/`
- Single test file: `node --import tsx --test src/path/to/file.test.ts`
- Spec: `docs/superpowers/specs/2026-07-15-recurring-schedules-design.md`
- Duration strings: `30s` / `5m` / `1h` / `1d` (extend existing parser — today it lacks `d`)
- Overlap policy: skip; no backfill for missed ticks
- Identity git sync today only `git add identity/` — schedule commits must also stage `agent/schedules/`

---

## File Map

**Created:**
- `packages/runtime/src/engine/schedules.ts` — types, validation helpers, due-time pure functions
- `packages/runtime/src/engine/schedules.test.ts`
- `packages/runtime/src/engine/schedule-runner.ts` — poll loop, fire, reload, in-flight tracking
- `packages/runtime/src/engine/schedule-runner.test.ts`
- `packages/runtime/src/tools/schedules.ts` — list/upsert/enable/delete tools
- `packages/runtime/src/tools/schedules.test.ts`
- `packages/runtime/src/engine/identity-pull.ts` — one pull cycle (commit dirty → pull --rebase → reload hook)
- `packages/runtime/src/engine/identity-pull.test.ts`

**Modified:**
- `packages/runtime/src/config.ts` — export/extend duration parser with `d`; resolve `identity.pullInterval`
- `packages/runtime/src/config.test.ts`
- `packages/runtime/src/api/types.ts` — `IdentityConfig.pullInterval?: string`
- `packages/runtime/artificer.config.schema.json` — `identity.pullInterval`
- `packages/runtime/src/storage/identity-layout.ts` — `schedulesDir`, `scheduleFile(id)`
- `packages/runtime/src/discover/discover.ts` — `schedules: ModuleRef[]`
- `packages/runtime/src/discover/loader.ts` — `loadSchedulesFromDisk`
- `packages/runtime/src/discover/loader.test.ts`
- `packages/runtime/src/storage/layout.ts` — `scheduleStateFile()`
- `packages/runtime/src/storage/store.ts` — read/write schedule state
- `packages/runtime/src/storage/store.test.ts`
- `packages/runtime/src/storage/identity-git-sync.ts` — public `pullFromRemote()`, commit paths include `agent/schedules/`
- `packages/runtime/src/storage/identity-git-sync.test.ts`
- `packages/runtime/src/context.ts` — optional `schedules` API on `EngineApi` (or tool factories take runner)
- `packages/runtime/src/tools/registry.ts` — register schedule tools on communicator
- `packages/runtime/src/api/create-runtime.ts` — construct/attach ScheduleRunner if used there
- `packages/runtime/src/index.ts` — start ScheduleRunner + identity pull timers
- `docs/reference/config.md` — document `identity.pullInterval`
- `docs/reference/` or guides — brief schedules note (fold into config/docs task)

---

### Task 1: Duration parser + `identity.pullInterval` config

**Files:**
- Modify: `packages/runtime/src/config.ts`
- Modify: `packages/runtime/src/config.test.ts`
- Modify: `packages/runtime/src/api/types.ts`
- Modify: `packages/runtime/artificer.config.schema.json`
- Modify: `docs/reference/config.md`

**Interfaces:**
- Produces: `parseDuration(s: string): number | undefined` supporting `ms|s|m|h|d`; `IdentityConfig.pullInterval?: string`; `RuntimeConfig.identity` may carry `pullIntervalMs?: number` (either extend `IdentityConfig` with resolved ms in RuntimeConfig, or add `identityPullIntervalMs?: number` on `RuntimeConfig` — prefer resolving onto runtime as `identity.pullIntervalMs` by widening the runtime identity shape)

- [ ] **Step 1: Write failing tests for day duration and pullInterval merge**

In `packages/runtime/src/config.test.ts` add:

```typescript
test('parseDuration accepts day units', async () => {
  const { parseDuration } = await import('./config.js');
  assert.equal(parseDuration('1d'), 86_400_000);
  assert.equal(parseDuration('2d'), 172_800_000);
  assert.equal(parseDuration('1h'), 3_600_000);
  assert.equal(parseDuration('nope'), undefined);
});

test('identity.pullInterval resolves to pullIntervalMs', () => {
  const config = mergeWithDefinition({
    name: 'test',
    identity: { pullInterval: '5m' },
  });
  assert.equal(config.identity?.pullIntervalMs, 300_000);
});
```

Export `parseDuration` from `config.ts`. Keep `parseInterval` as a thin alias or replace internal uses with `parseDuration`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && node --import tsx --test src/config.test.ts`

Expected: FAIL — `parseDuration` not exported / `pullIntervalMs` missing.

- [ ] **Step 3: Implement parser + config wiring**

In `packages/runtime/src/api/types.ts`:

```typescript
export interface IdentityConfig {
  autoCommit?: boolean;
  autoPush?: boolean;
  commitPrefix?: string;
  remote?: string;
  branch?: string;
  /** How often to pull identity from origin. Duration string e.g. "5m". Absent disables. */
  pullInterval?: string;
}
```

In `config.ts`, replace `parseInterval` with:

```typescript
export function parseDuration(s: string): number | undefined {
  const m = s.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'ms': return n;
    case 's': return n * 1000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    case 'd': return n * 86_400_000;
    default: return undefined;
  }
}
```

Widen runtime identity (on `RuntimeConfig`) to include resolved `pullIntervalMs?: number`. In `mergeWithDefinition`, when merging `identity`:

```typescript
identity: definition.identity
  ? {
      ...definition.identity,
      pullIntervalMs: definition.identity.pullInterval
        ? parseDuration(definition.identity.pullInterval)
        : undefined,
    }
  : base.identity,
```

If `RuntimeConfig.identity` is typed as `IdentityConfig`, either:
- add `pullIntervalMs?: number` to a `ResolvedIdentityConfig extends IdentityConfig`, or
- put `pullIntervalMs` only on `RuntimeConfig` as `identityPullIntervalMs`.

**Prefer:** `export interface ResolvedIdentityConfig extends IdentityConfig { pullIntervalMs?: number }` and type `RuntimeConfig.identity` as `ResolvedIdentityConfig | undefined`.

Update schema `identity.properties.pullInterval` as string with description matching `github.watchInterval`.

Update `docs/reference/config.md` identity table with `identity.pullInterval`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && node --import tsx --test src/config.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/config.ts packages/runtime/src/config.test.ts \
  packages/runtime/src/api/types.ts packages/runtime/artificer.config.schema.json \
  docs/reference/config.md
git commit -m "$(cat <<'EOF'
feat: add identity.pullInterval and day durations

Support 1d in duration parsing and resolve pullInterval for identity sync.
EOF
)"
```

---

### Task 2: Discover + load schedule files

**Files:**
- Modify: `packages/runtime/src/storage/identity-layout.ts`
- Modify: `packages/runtime/src/discover/discover.ts`
- Modify: `packages/runtime/src/discover/loader.ts`
- Modify: `packages/runtime/src/discover/loader.test.ts`
- Create: `packages/runtime/src/engine/schedules.ts` (types + validate only in this task; due logic in Task 3)

**Interfaces:**
- Produces:
  - `IdentityLayout.schedulesDir`, `scheduleFile(id: string)`
  - `AgentManifest.schedules: ModuleRef[]`
  - `export interface ScheduleDefinition { id: string; name: string; everyMs?: number; cron?: string; timezone: string; action: 'communicator' | 'workstream'; enabled: boolean; body: string; sourcePath: string }`
  - `export function loadSchedulesFromDisk(refs: ModuleRef[]): ScheduleDefinition[]`
  - `export function validateScheduleFields(input: {...}): { ok: true; value: ... } | { ok: false; error: string }`
  - `export function isSafeScheduleId(id: string): boolean`

- [ ] **Step 1: Write failing loader tests**

In `loader.test.ts`:

```typescript
import { loadSchedulesFromDisk } from './loader.js';

describe('loadSchedulesFromDisk', () => {
  it('parses every + communicator schedule', () => {
    const p = path.join(tmpDir, 'morning.md');
    fs.writeFileSync(
      p,
      `---
name: Morning check-in
every: 1d
action: communicator
enabled: true
---
Check in.
`,
    );
    const schedules = loadSchedulesFromDisk([{ name: 'morning', path: p }]);
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].id, 'morning');
    assert.equal(schedules[0].name, 'Morning check-in');
    assert.equal(schedules[0].everyMs, 86_400_000);
    assert.equal(schedules[0].action, 'communicator');
    assert.equal(schedules[0].enabled, true);
    assert.match(schedules[0].body, /Check in/);
  });

  it('parses cron + timezone + workstream', () => {
    const p = path.join(tmpDir, 'prune.md');
    fs.writeFileSync(
      p,
      `---
name: Weekly prune
cron: 0 9 * * 1
timezone: America/Los_Angeles
action: workstream
---
Prune memories.
`,
    );
    const schedules = loadSchedulesFromDisk([{ name: 'prune', path: p }]);
    assert.equal(schedules[0].cron, '0 9 * * 1');
    assert.equal(schedules[0].timezone, 'America/Los_Angeles');
    assert.equal(schedules[0].action, 'workstream');
  });

  it('skips invalid files and keeps valid ones', () => {
    const bad = path.join(tmpDir, 'bad.md');
    const good = path.join(tmpDir, 'good.md');
    fs.writeFileSync(bad, `---\naction: communicator\n---\nNo timing.\n`);
    fs.writeFileSync(
      good,
      `---\nevery: 1h\naction: communicator\n---\nHi.\n`,
    );
    const schedules = loadSchedulesFromDisk([
      { name: 'bad', path: bad },
      { name: 'good', path: good },
    ]);
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].id, 'good');
  });
});
```

Also add a unit test in `schedules.test.ts` for `isSafeScheduleId` rejecting `../x` and accepting `morning-check`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && node --import tsx --test src/discover/loader.test.ts`

Expected: FAIL — `loadSchedulesFromDisk` missing.

- [ ] **Step 3: Implement layout, discover, loader, validation**

`identity-layout.ts`:

```typescript
get schedulesDir(): string {
  return path.join(this.root, 'agent', 'schedules');
}
scheduleFile(id: string): string {
  return path.join(this.schedulesDir, `${id}.md`);
}
```

`discover.ts`: add `schedules: ModuleRef[]` to manifest; populate with `listByExt(path.join(rootDir, 'agent', 'schedules'), '.md')`.

`schedules.ts` — validation + serialize helpers used by loader and tools:

```typescript
export type ScheduleAction = 'communicator' | 'workstream';

export interface ScheduleDefinition {
  id: string;
  name: string;
  everyMs?: number;
  cron?: string;
  timezone: string;
  action: ScheduleAction;
  enabled: boolean;
  body: string;
  sourcePath: string;
}

export function isSafeScheduleId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);
}

export function parseCronExpression(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 ? parts.join(' ') : null;
}
```

Reuse the same frontmatter parser pattern as roles (`parseRoleFrontmatter` — extract shared helper or duplicate the small regex block in loader). Map `every` via `parseDuration`. Default `timezone` to `'UTC'`, `enabled` to `true`, `name` to id. Require exactly one of every/cron, valid action, non-empty body. On failure, `console.warn` and skip.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && node --import tsx --test src/discover/loader.test.ts src/engine/schedules.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/storage/identity-layout.ts \
  packages/runtime/src/discover/discover.ts \
  packages/runtime/src/discover/loader.ts \
  packages/runtime/src/discover/loader.test.ts \
  packages/runtime/src/engine/schedules.ts \
  packages/runtime/src/engine/schedules.test.ts
git commit -m "$(cat <<'EOF'
feat: load agent/schedules markdown definitions

Discover and validate schedule files with every/cron frontmatter.
EOF
)"
```

---

### Task 3: Due-time logic (`every` + cron)

**Files:**
- Modify: `packages/runtime/src/engine/schedules.ts`
- Modify: `packages/runtime/src/engine/schedules.test.ts`

**Interfaces:**
- Produces:
  - `export function isScheduleDue(args: { schedule: ScheduleDefinition; nowMs: number; lastFiredAt: number | null; startedAtMs: number }): boolean`
  - `export function cronMatchesMinute(cron: string, date: Date, timeZone: string): boolean`
  - `export function nextDueHint(...): number | null` (optional; used by `list_schedules`)

- [ ] **Step 1: Write failing due-logic tests**

```typescript
test('every: not due until one full interval after start when never fired', () => {
  const schedule = {
    id: 'x',
    name: 'x',
    everyMs: 60_000,
    timezone: 'UTC',
    action: 'communicator' as const,
    enabled: true,
    body: 'hi',
    sourcePath: '/tmp/x.md',
  };
  const startedAtMs = 1_000_000;
  assert.equal(
    isScheduleDue({ schedule, nowMs: startedAtMs + 30_000, lastFiredAt: null, startedAtMs }),
    false,
  );
  assert.equal(
    isScheduleDue({ schedule, nowMs: startedAtMs + 60_000, lastFiredAt: null, startedAtMs }),
    true,
  );
});

test('every: due when now >= lastFired + interval', () => {
  const schedule = { /* everyMs: 60_000, ... */ };
  assert.equal(
    isScheduleDue({
      schedule,
      nowMs: 200_000,
      lastFiredAt: 100_000,
      startedAtMs: 0,
    }),
    true,
  );
  assert.equal(
    isScheduleDue({
      schedule,
      nowMs: 150_000,
      lastFiredAt: 100_000,
      startedAtMs: 0,
    }),
    false,
  );
});

test('cron: matches weekday 9:00 America/Los_Angeles', () => {
  // Pick a known instant: 2026-07-13 09:00 PDT = Monday
  const date = new Date('2026-07-13T16:00:00.000Z'); // 09:00 PDT
  assert.equal(cronMatchesMinute('0 9 * * 1', date, 'America/Los_Angeles'), true);
  assert.equal(cronMatchesMinute('0 9 * * 1', date, 'UTC'), false);
});

test('cron schedule: due only once per matching minute', () => {
  const schedule = {
    id: 'c',
    name: 'c',
    cron: '0 9 * * 1',
    timezone: 'America/Los_Angeles',
    action: 'workstream' as const,
    enabled: true,
    body: 'x',
    sourcePath: '/tmp/c.md',
  };
  const nowMs = Date.parse('2026-07-13T16:00:30.000Z');
  assert.equal(
    isScheduleDue({ schedule, nowMs, lastFiredAt: null, startedAtMs: 0 }),
    true,
  );
  assert.equal(
    isScheduleDue({
      schedule,
      nowMs,
      lastFiredAt: Date.parse('2026-07-13T16:00:05.000Z'),
      startedAtMs: 0,
    }),
    false,
  );
});

test('disabled schedules are never due', () => {
  const schedule = { /* enabled: false, everyMs: 1, ... */ };
  assert.equal(
    isScheduleDue({ schedule, nowMs: 999999, lastFiredAt: null, startedAtMs: 0 }),
    false,
  );
});
```

Implement `cronMatchesMinute` by formatting `date` in `timeZone` into `{ minute, hour, day, month, weekday }` via `Intl.DateTimeFormat` with `timeZone` + `hourCycle: 'h23'`, then match each of the 5 cron fields (support `*`, `N`, `N-M`, `*/N`, comma lists). Weekday: Sunday=0 … Saturday=6 to match standard cron.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && node --import tsx --test src/engine/schedules.test.ts`

Expected: FAIL — functions missing.

- [ ] **Step 3: Implement due logic**

Add the functions to `schedules.ts`. Keep cron parsing strict: invalid field → `cronMatchesMinute` returns false.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && node --import tsx --test src/engine/schedules.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/schedules.ts packages/runtime/src/engine/schedules.test.ts
git commit -m "$(cat <<'EOF'
feat: schedule due-time logic for intervals and cron

Evaluate every/cron schedules with timezone-aware minute matching.
EOF
)"
```

---

### Task 4: Persist schedule last-fired state

**Files:**
- Modify: `packages/runtime/src/storage/layout.ts`
- Modify: `packages/runtime/src/storage/store.ts`
- Modify: `packages/runtime/src/storage/store.test.ts`
- Modify: `packages/runtime/src/engine/schedules.ts` (state types)

**Interfaces:**
- Produces:
  - `export interface ScheduleRuntimeState { schedules: Record<string, { lastFiredAt: number }> }`
  - `emptyScheduleRuntimeState(): ScheduleRuntimeState`
  - `Store.readScheduleState(): Promise<ScheduleRuntimeState>`
  - `Store.writeScheduleState(state: ScheduleRuntimeState): Promise<void>`
  - `Layout.scheduleStateFile(): string` → `{root}/schedule-state.json`

- [ ] **Step 1: Write failing store test**

Mirror `readGithubWatchState` test:

```typescript
test('readScheduleState defaults to empty, writeScheduleState persists it', async () => {
  const store = await createTempStore();
  const empty = await store.readScheduleState();
  assert.deepEqual(empty, { schedules: {} });

  const next = {
    schedules: { morning: { lastFiredAt: 123 } },
  };
  await store.writeScheduleState(next);
  assert.deepEqual(await store.readScheduleState(), next);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/storage/store.test.ts`

Expected: FAIL — methods missing.

- [ ] **Step 3: Implement layout + store methods**

Same JSON read/write helpers as GitHub watch state.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/storage/layout.ts \
  packages/runtime/src/storage/store.ts \
  packages/runtime/src/storage/store.test.ts \
  packages/runtime/src/engine/schedules.ts
git commit -m "$(cat <<'EOF'
feat: persist schedule last-fired state

Store schedule runtime state in schedule-state.json under the data root.
EOF
)"
```

---

### Task 5: ScheduleRunner (poll, skip overlap, fire hooks)

**Files:**
- Create: `packages/runtime/src/engine/schedule-runner.ts`
- Create: `packages/runtime/src/engine/schedule-runner.test.ts`

**Interfaces:**
- Produces:

```typescript
export interface ScheduleFireDeps {
  nowMs: () => number;
  receiveMessage: (content: string) => Promise<{ messageId: string }>;
  createWorkstream: (input: {
    title: string;
    goal: string;
  }) => Promise<{ workstreamId: string }>;
  readState: () => Promise<ScheduleRuntimeState>;
  writeState: (state: ScheduleRuntimeState) => Promise<void>;
  isCommunicatorRunTerminal?: (messageId: string) => Promise<boolean>;
  isWorkstreamTerminal?: (workstreamId: string) => Promise<boolean>;
  log?: (message: string) => void;
}

export class ScheduleRunner {
  constructor(deps: ScheduleFireDeps & { pollIntervalMs?: number });
  reload(definitions: ScheduleDefinition[]): void;
  list(): Array<ScheduleDefinition & { lastFiredAt: number | null; inFlight: boolean }>;
  /** Single poll iteration (exported for tests). */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}
```

**In-flight clearing (no Engine hooks required):** track
`Map<id, { kind: 'communicator'; messageId: string } | { kind: 'workstream'; workstreamId: string }>`.
At the start of each `tick`, clear entries whose terminal predicates return true.

**Accept / stamp:** before calling fire deps, write `lastFiredAt = now` and set in-flight. If fire throws before returning ids, revert `lastFiredAt` and clear in-flight (rejected-before-accept). If fire returns ids, keep stamp.

**Communicator content:** `` `[schedule:${id}] ${body}` ``

**First interval:** `startedAtMs` captured in constructor / `start()`.

- [ ] **Step 1: Write failing runner tests**

```typescript
test('fires communicator when every interval elapses', async () => {
  let now = 0;
  const messages: string[] = [];
  const runner = new ScheduleRunner({
    nowMs: () => now,
    pollIntervalMs: 1_000_000, // don't auto-start timer in tests; call tick()
    receiveMessage: async (content) => {
      messages.push(content);
      return { messageId: 'm1' };
    },
    createWorkstream: async () => ({ workstreamId: 'w1' }),
    readState: async () => state,
    writeState: async (s) => {
      state = s;
    },
    isCommunicatorRunTerminal: async () => true,
    isWorkstreamTerminal: async () => true,
  });
  runner.reload([
    {
      id: 'hb',
      name: 'HB',
      everyMs: 1000,
      timezone: 'UTC',
      action: 'communicator',
      enabled: true,
      body: 'Wake up',
      sourcePath: '/tmp/hb.md',
    },
  ]);

  now = 999;
  await runner.tick();
  assert.equal(messages.length, 0);

  now = 1000;
  await runner.tick();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /\[schedule:hb\]/);
  assert.match(messages[0], /Wake up/);
});

test('skips when previous fire still in flight', async () => {
  // isCommunicatorRunTerminal returns false; second tick must not fire again
});

test('fires workstream action via createWorkstream', async () => {
  // assert createWorkstream called with title/goal from schedule
});
```

Do **not** call `start()` in unit tests — only `tick()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && node --import tsx --test src/engine/schedule-runner.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement ScheduleRunner**

Implement as specified. `start()` uses `setTimeout` chain like GitHub watch in `index.ts` (or `setInterval`); `stop()` clears the timer.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/schedule-runner.ts \
  packages/runtime/src/engine/schedule-runner.test.ts
git commit -m "$(cat <<'EOF'
feat: add ScheduleRunner poll loop

Fire due schedules with skip-on-overlap and lastFired persistence hooks.
EOF
)"
```

---

### Task 6: Wire ScheduleRunner to Engine + runtime startup

**Files:**
- Modify: `packages/runtime/src/api/create-runtime.ts` (or wherever Engine is constructed)
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/runtime/src/engine/engine.ts` only if small helpers are needed
- Possibly create: `packages/runtime/src/engine/schedule-runner-host.ts` for wiring helpers

**Interfaces:**
- Produces: runtime constructs `ScheduleRunner` with real deps:
  - `receiveMessage` → `engine.receiveMessage` then return `{ messageId: message.id }`
  - `createWorkstream` → `engine.createDirectWorkstream({ title, goal, autostart: true })` → `{ workstreamId }`
  - `isCommunicatorRunTerminal`: list runs with `originMessageId === messageId`; if none yet → false; terminal when every matching run has `status` in `done | failed` (`RunStatus`)
  - `isWorkstreamTerminal`: workstream `status` in `done | failed | cancelled` (`WorkstreamStatus`)
  - Load schedules via `scanAgentDirectory` + `loadSchedulesFromDisk` from `config.identityDir` / agent root
  - `start()` when process starts; always start runner even if zero schedules (tools may add later)

- [ ] **Step 1: Inspect RunRecord / WorkstreamStatus enums and write one integration-style unit test with a fake Engine store if feasible**

Prefer a focused test that wires terminal checks against Store APIs in isolation (helper functions `communicatorRunTerminal(store, messageId)` / `workstreamTerminal(store, id)` in `schedule-runner-host.ts`).

- [ ] **Step 2: Implement host wiring + start from `index.ts`**

```typescript
// index.ts (alongside github watch)
const scheduleRunner = createScheduleRunnerForEngine(engine);
scheduleRunner.start();
console.log('[artificer-runtime] Schedule runner enabled');
```

Reload path: expose `engine.reloadSchedules()` or keep runner on a module-level/engine field so tools can call `runner.reload(...)`.

Attach runner to engine for tools, e.g. `engine.attachScheduleRunner(runner)` setting `private scheduleRunner`.

- [ ] **Step 3: Run relevant tests**

Run: `cd packages/runtime && node --import tsx --test src/engine/schedule-runner.test.ts src/storage/store.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/index.ts packages/runtime/src/api/create-runtime.ts \
  packages/runtime/src/engine/engine.ts packages/runtime/src/engine/schedule-runner-host.ts
git commit -m "$(cat <<'EOF'
feat: start ScheduleRunner with the runtime

Wire schedule fires into receiveMessage and createDirectWorkstream.
EOF
)"
```

---

### Task 7: Identity pull cycle + timer

**Files:**
- Modify: `packages/runtime/src/storage/identity-git-sync.ts`
- Modify: `packages/runtime/src/storage/identity-git-sync.test.ts`
- Create: `packages/runtime/src/engine/identity-pull.ts`
- Create: `packages/runtime/src/engine/identity-pull.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces:
  - `IdentityGitSync.pullFromRemote(): Promise<'updated' | 'unchanged' | 'conflict' | 'error'>`
  - Expand `git add` in commit path to include `agent/schedules/` (and when committing schedule tool writes, message prefix e.g. `schedule:`)
  - `runIdentityPullCycle({ identity, onSchedulesChanged }: ...): Promise<void>`

**Pull algorithm:**

1. If `autoCommit`, attempt commit of dirty `identity/` + `agent/schedules/` (reuse commit helper; ignore "nothing to commit")
2. `git rev-parse HEAD` before
3. `git pull --rebase <remote> [<branch>]`
4. On conflict: `git rebase --abort`, return `'conflict'`
5. Compare HEAD after; if changed return `'updated'` else `'unchanged'`
6. Caller on `'updated'`: reload schedules from disk into ScheduleRunner

- [ ] **Step 1: Write failing tests**

- Unit-test commit staging includes `agent/schedules/` when a schedule file is new (extend existing identity-git-sync temp repo tests).
- Unit-test `pullFromRemote` conflict path with a mocked `exec` if the class allows injection; otherwise test via real temp git repos (two clones) — prefer real git in tests like existing sync tests.

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL

- [ ] **Step 3: Implement pull + stage schedules + index timer**

In `index.ts`:

```typescript
const pullMs = config.identity?.pullIntervalMs;
if (pullMs && engine.identity instanceof IdentityGitSync) {
  const scheduleNext = () => {
    setTimeout(() => {
      runIdentityPullCycle({
        identity: engine.identity as IdentityGitSync,
        reloadSchedules: () => scheduleRunner.reloadFromDisk(),
        log: (m) => console.log(`[artificer-runtime] [identity-pull] ${m}`),
      })
        .catch((err) => console.error('[artificer-runtime] identity pull failed:', err))
        .finally(scheduleNext);
    }, pullMs);
  };
  scheduleNext();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && node --import tsx --test src/storage/identity-git-sync.test.ts src/engine/identity-pull.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/storage/identity-git-sync.ts \
  packages/runtime/src/storage/identity-git-sync.test.ts \
  packages/runtime/src/engine/identity-pull.ts \
  packages/runtime/src/engine/identity-pull.test.ts \
  packages/runtime/src/index.ts
git commit -m "$(cat <<'EOF'
feat: periodic identity pull from origin

Pull on identity.pullInterval and reload schedules after updates.
EOF
)"
```

---

### Task 8: Agent schedule tools

**Files:**
- Create: `packages/runtime/src/tools/schedules.ts`
- Create: `packages/runtime/src/tools/schedules.test.ts`
- Modify: `packages/runtime/src/tools/registry.ts`
- Modify: `packages/runtime/src/context.ts` / `engine.ts` as needed for runner access
- Modify: `packages/runtime/src/storage/identity-git-sync.ts` if schedule writes need `commitPaths`

**Interfaces:**
- Produces tools: `list_schedules`, `upsert_schedule`, `set_schedule_enabled`, `delete_schedule`
- `EngineApi` gains schedule operations OR tools receive `ScheduleRunner` + identity layout via ctx:

```typescript
// Preferred: methods on EngineApi
listSchedules(): ScheduleListItem[];
upsertSchedule(input: {
  id: string;
  name?: string;
  every?: string;
  cron?: string;
  timezone?: string;
  action: 'communicator' | 'workstream';
  enabled?: boolean;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }>;
setScheduleEnabled(id: string, enabled: boolean): Promise<...>;
deleteSchedule(id: string): Promise<...>;
```

Implementation writes markdown via a `serializeSchedule(def): string` helper in `schedules.ts`, path from `identity.layout.scheduleFile(id)`, then `identity` commit if `IdentityGitSync`, then `runner.reload(loadSchedulesFromDisk(...))`.

`delete_schedule` also removes `state.schedules[id]` from persisted state.

Register on communicator in `registry.ts` (full set). Optionally also expose `list_schedules` to orchestrator — V1 communicator-only is enough.

- [ ] **Step 1: Write failing tool tests**

Use temp dir + fake engine/runner similar to other tool tests (`orchestrator-tool.test.ts` pattern):

```typescript
test('upsert_schedule writes file and reloads', async () => { ... });
test('upsert_schedule rejects unsafe id', async () => { ... });
test('set_schedule_enabled flips frontmatter', async () => { ... });
test('delete_schedule removes file and state', async () => { ... });
test('list_schedules includes lastFired and inFlight', async () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && node --import tsx --test src/tools/schedules.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement tools + registry + engine methods**

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/tools/schedules.ts \
  packages/runtime/src/tools/schedules.test.ts \
  packages/runtime/src/tools/registry.ts \
  packages/runtime/src/context.ts \
  packages/runtime/src/engine/engine.ts \
  packages/runtime/src/engine/schedules.ts
git commit -m "$(cat <<'EOF'
feat: add agent tools for managing schedules

Allow the communicator to list, upsert, pause, and delete schedules.
EOF
)"
```

---

### Task 9: Docs polish + status update

**Files:**
- Modify: `docs/reference/config.md` (if anything left from Task 1)
- Modify: `docs/superpowers/specs/2026-07-15-recurring-schedules-design.md` — Status: Approved
- Add a short subsection under an existing guide or `docs/reference/` describing `agent/schedules/` (keep minimal — one page section in config.md or a new `docs/reference/schedules.md` if reference docs are split that way; check `docs/` layout and match)

- [ ] **Step 1: Write user-facing docs for schedule file format** (copy examples from the spec)

- [ ] **Step 2: Mark design spec Status as Approved**

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: document recurring schedules and mark spec approved
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `agent/schedules/*.md` format | 2, 8 |
| `every` + `cron` + timezone | 2, 3 |
| `action: communicator \| workstream` | 5, 6 |
| Skip on overlap | 5 |
| lastFired in data store | 4, 5 |
| First `every` waits one full interval | 3, 5 |
| No missed-tick backfill | 3 |
| Agent tools CRUD/pause | 8 |
| `identity.pullInterval` pull | 1, 7 |
| Conflict → abort, no auto-resolve | 7 |
| Stage/commit schedule files | 7, 8 |
| Invalid file skip | 2 |
| Quota via existing engine paths | 6 |
| Optional GET /api/schedules | Out of scope (nice-to-have; skip unless free) |

## Placeholder / consistency notes

- Use `parseDuration` everywhere for schedule `every` and config intervals.
- Terminal status strings must match `storage/types.ts` exactly at implementation time — verify before coding Task 6.
- `IdentityGitSync` must stage `agent/schedules/` or schedule tools will not sync to GitHub.
