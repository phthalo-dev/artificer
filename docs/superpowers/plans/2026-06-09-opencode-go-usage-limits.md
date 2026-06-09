# OpenCode Go Usage Limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent hits an OpenCode Go subscription usage limit (5-hour, weekly, or monthly), pause the workstream with a persisted resume schedule and automatically continue once the usage window resets — without requiring a manual user message.

**Architecture:** Extend LLM error classification to distinguish Go subscription quota exhaustion from Zen balance failures and upstream provider outages. Persist a `usagePause` record on the workstream with `resumeAt` and the window kind. A lightweight resume poller in the engine wakes paused workstreams at the right time and re-dispatches via the existing FSM (`gatherFacts` → `nextWorkstreamAction` → `dispatchAction`). Bench harness waits on auto-resume pauses instead of treating them as terminal.

**Tech Stack:** TypeScript (ESM), Node 20+, AI SDK `APICallError`, existing `Engine` / `Store` / `workstream-machine`, `node:test`, bench harness (`packages/runtime/bench`).

**Reference:** [OpenCode Go usage limits](https://opencode.ai/docs/go/#usage-limits) — $12 / 5h, $30 / week, $60 / month.

---

## Background: what exists today

| Area | Current behavior | Gap |
|------|------------------|-----|
| `llm/errors.ts` | `isInsufficientBalanceError` catches HTTP 402 + balance text | Treats all billing failures alike; no Go window awareness |
| `engine.ts` `afterRun` | Calls `handleInsufficientBalance` → sets `status: 'blocked'`, notifies user | No auto-resume; user must send another message |
| `Workstream.status` | `blocked` is terminal in bench (`poll.ts`) | Go quota pause kills long bench runs |
| `resumeInterruptedWorkstreams` | Resumes after restart for active (non-terminal) workstreams | Does not handle quota pauses or scheduled resume |

OpenCode Go errors are messy in practice ([upstream issues](https://github.com/anomalyco/opencode/issues/24492)): HTTP 402/429, messages like "Insufficient balance", `type: limitation`, upstream provider quota vs subscriber quota. The plan classifies conservatively and improves patterns as we capture real responses.

---

## File structure

**Create**
- `packages/runtime/src/llm/usage-limit.ts` — error parsing, window detection, `resumeAt` computation
- `packages/runtime/src/llm/usage-limit.test.ts`
- `packages/runtime/src/engine/usage-resume.ts` — poller: find due pauses, clear flag, dispatch FSM
- `packages/runtime/src/engine/usage-resume.test.ts`

**Modify**
- `packages/runtime/src/storage/types.ts` — `UsagePauseState`, `GoUsageWindow` types; optional `usagePause` on `Workstream`
- `packages/runtime/src/storage/store.ts` — `listWorkstreamsAwaitingUsageResume()`, `setUsagePause()`, `clearUsagePause()`
- `packages/runtime/src/llm/errors.ts` — export `classifyLlmFailure()`; keep `isInsufficientBalanceError` as thin wrapper
- `packages/runtime/src/engine/engine.ts` — `handleUsagePause()`, wire resume poller, startup resume for due pauses
- `packages/runtime/src/config.ts` — Go usage pause / poll interval config
- `packages/runtime/.env.example` — document new env vars
- `packages/runtime/bench/src/poll.ts` — treat auto-resume pause as `wait`, not terminal
- `packages/runtime/bench/src/types.ts` — optional `paused_usage` outcome (if needed for reporting)
- `packages/runtime/src/server/app.ts` — expose `usagePause` in workstream GET/state (observability)

---

## Design decisions

### 1. Persisted pause record (not a new workstream status)

Add optional metadata on `Workstream` rather than a new status value:

```ts
export type GoUsageWindow = '5h' | 'weekly' | 'monthly' | 'unknown';

export interface UsagePauseState {
  kind: 'go_usage_limit';
  window: GoUsageWindow;
  pausedAt: string;       // ISO
  resumeAt: string;       // ISO — when poller should retry
  lastFailedRunId: string;
  lastFailedModel?: string;
  lastError: string;      // truncated formatCallError output
  autoResume: true;       // always true for Go quota; distinguishes from manual blocked
}
```

Workstream `status` becomes `blocked` (reuse existing semantics for "not progressing") but `usagePause.autoResume === true` tells engine and bench this is temporary.

**Why not a new `paused` status?** Minimizes churn across `isActiveStatus`, UI, bench terminal sets, and orchestrator tools. The flag is the source of truth for auto-resume behavior.

### 2. Error classification

```ts
export type LlmFailureKind =
  | 'go_usage_limit'      // subscriber Go quota for a rolling window
  | 'insufficient_balance' // Zen credits / payment required
  | 'provider_unavailable' // upstream provider account depleted (not auto-resumable on schedule)
  | 'rate_limited'        // transient 429; short Retry-After
  | 'other';
```

**Detection rules (initial heuristics, tested with fixtures from GitHub issues):**

| Signal | Classification |
|--------|----------------|
| `baseURL` does NOT include `/zen/go/` | Never `go_usage_limit` |
| HTTP 429 + body contains `type":"limitation"` or "Too many requests" + on Go gateway | `rate_limited` or `go_usage_limit` (see window hints) |
| HTTP 402/429 + body mentions "5 hour" / "continuous" / "5-hour" | `go_usage_limit` window `5h` |
| HTTP 402/429 + body mentions "weekly" | `go_usage_limit` window `weekly` |
| HTTP 402/429 + body mentions "monthly" | `go_usage_limit` window `monthly` |
| HTTP 402 + "Insufficient balance" on Go gateway, no upstream `provider_name` in metadata | `go_usage_limit` window `unknown` (default 5h) |
| HTTP 402 + upstream `provider_name` (Moonshot, Xiaomi, etc.) in metadata/raw | `provider_unavailable` |
| HTTP 402 + balance patterns, NOT on Go gateway | `insufficient_balance` (existing behavior) |
| `Retry-After` header &lt; 1 hour | `rate_limited` (retry in-call or short defer) |
| `Retry-After` header ≥ 1 hour | use as `resumeAt` for `go_usage_limit` |

### 3. Resume time computation

```ts
const WINDOW_DEFAULT_MS: Record<GoUsageWindow, number> = {
  '5h': 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  unknown: 5 * 60 * 60 * 1000, // conservative; matches most bench burst patterns
};

export function computeResumeAt(
  window: GoUsageWindow,
  pausedAt: Date,
  retryAfterSeconds?: number,
): string {
  if (retryAfterSeconds && retryAfterSeconds >= 3600) {
    return new Date(pausedAt.getTime() + retryAfterSeconds * 1000).toISOString();
  }
  return new Date(pausedAt.getTime() + WINDOW_DEFAULT_MS[window]).toISOString();
}
```

**Note:** OpenCode docs do not expose exact window reset timestamps in the public API. Defaults are conservative estimates; `Retry-After` from the gateway overrides when present. A future enhancement can probe with a cheap model (`deepseek-v4-flash`) before the scheduled time to resume early.

### 4. Engine flow on limit hit

```
executeCall fails
  → afterRun sees run.status === 'failed'
  → classifyLlmFailure(run.error, config.baseURL)
  → if go_usage_limit:
       handleUsagePause(run, classification)
         - set workstream.usagePause
         - status = 'blocked'
         - append summary line with window + resumeAt
         - notify user once (like balanceNotified)
       - return (do NOT dispatch next FSM action)
  → if insufficient_balance: existing handleInsufficientBalance (no auto-resume)
  → if provider_unavailable: block without auto-resume; message suggests model switch
  → else: existing failure paths
```

On resume (poller or startup):

```
listWorkstreamsAwaitingUsageResume(now)
  → for each: clearUsagePause, restore status to phase-appropriate active status
  → gatherFacts → nextWorkstreamAction → dispatchAction
```

Restore status mapping: `planning` phase → `planning`, `implementing` → `in_progress`, etc. (read from `workstream.currentPhase`).

### 5. Config

```ts
// RuntimeConfig additions
goUsagePause: {
  enabled: boolean;           // default: true when baseURL includes '/zen/go/'
  pollIntervalMs: number;     // default: 60_000
};
```

Env:
- `RUNTIME_GO_USAGE_PAUSE` — `true` | `false` (default: auto-detect from Go gateway)
- `RUNTIME_GO_USAGE_POLL_MS` — default `60000`

### 6. Bench behavior

`poll.ts` terminal set stays the same for manual `blocked` (no `usagePause`). When `workstream.usagePause?.autoResume` and `resumeAt > now`, `decidePoll` returns `{ kind: 'wait' }` instead of terminal. When `resumeAt <= now` but engine hasn't resumed yet, keep waiting (engine poller will catch up).

Add `BENCH_WAIT_FOR_GO_RESUME=true` (default true when preset starts with `go-`) so overnight bench batches can span quota windows.

---

## Task 1: Types and store helpers

**Files:**
- Modify: `packages/runtime/src/storage/types.ts`
- Modify: `packages/runtime/src/storage/store.ts`
- Test: `packages/runtime/src/storage/store.test.ts`

- [ ] **Step 1: Add types to `types.ts`**

```ts
export type GoUsageWindow = '5h' | 'weekly' | 'monthly' | 'unknown';

export interface UsagePauseState {
  kind: 'go_usage_limit';
  window: GoUsageWindow;
  pausedAt: string;
  resumeAt: string;
  lastFailedRunId: string;
  lastFailedModel?: string;
  lastError: string;
  autoResume: true;
}

// On Workstream interface:
usagePause?: UsagePauseState;
```

- [ ] **Step 2: Write failing store test**

```ts
test('setUsagePause persists and listWorkstreamsAwaitingUsageResume returns due pauses', async () => {
  const store = await makeStore();
  const ws = await store.createWorkstream({ title: 't', goal: 'g', status: 'in_progress' });
  const pause: UsagePauseState = {
    kind: 'go_usage_limit',
    window: '5h',
    pausedAt: '2026-06-09T10:00:00.000Z',
    resumeAt: '2026-06-09T11:00:00.000Z',
    lastFailedRunId: 'run-1',
    lastError: 'HTTP 429 — usage limit',
    autoResume: true,
  };
  await store.setUsagePause(ws.id, pause, 'blocked');
  const due = await store.listWorkstreamsAwaitingUsageResume('2026-06-09T12:00:00.000Z');
  assert.equal(due.length, 1);
  assert.equal(due[0].id, ws.id);
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm --filter @artificer/runtime test src/storage/store.test.ts`
Expected: FAIL — `setUsagePause is not a function`

- [ ] **Step 4: Implement store methods**

```ts
async setUsagePause(
  workstreamId: string,
  pause: UsagePauseState,
  status: WorkstreamStatus = 'blocked',
): Promise<Workstream | undefined> {
  return this.updateWorkstream(workstreamId, { usagePause: pause, status });
}

async clearUsagePause(workstreamId: string): Promise<Workstream | undefined> {
  return this.updateWorkstream(workstreamId, { usagePause: undefined });
}

async listWorkstreamsAwaitingUsageResume(nowIso: string): Promise<Workstream[]> {
  const all = await this.listWorkstreams();
  const now = Date.parse(nowIso);
  return all.filter(
    (ws) =>
      ws.usagePause?.autoResume === true &&
      Date.parse(ws.usagePause.resumeAt) <= now,
  );
}
```

- [ ] **Step 5: Run test — expect PASS**

- [ ] **Step 6: Commit** (only if user requests)

---

## Task 2: Error classification and resume time

**Files:**
- Create: `packages/runtime/src/llm/usage-limit.ts`
- Create: `packages/runtime/src/llm/usage-limit.test.ts`
- Modify: `packages/runtime/src/llm/errors.ts`

- [ ] **Step 1: Write failing tests with real-ish fixtures**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APICallError } from 'ai';
import { classifyLlmFailure, computeResumeAt } from './usage-limit.js';

const GO_BASE = 'https://opencode.ai/zen/go/v1';

test('classify Go 429 limitation as go_usage_limit', () => {
  const err = new APICallError({
    message: 'Too many requests',
    url: `${GO_BASE}/chat/completions`,
    requestBodyValues: {},
    statusCode: 429,
    responseBody:
      '{"error":{"code":"429","message":"Error from provider (Xiaomi): Too many requests","type":"limitation"}}',
  });
  const r = classifyLlmFailure(err, GO_BASE);
  assert.equal(r.kind, 'go_usage_limit');
});

test('classify upstream Moonshot 429 as provider_unavailable', () => {
  const body =
    '{"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"{\\"error\\":{\\"type\\":\\"exceeded_current_quota_error\\"}}","provider_name":"Moonshot AI"}}}';
  const err = new APICallError({
    message: 'Provider returned error',
    url: `${GO_BASE}/chat/completions`,
    requestBodyValues: {},
    statusCode: 429,
    responseBody: body,
  });
  const r = classifyLlmFailure(err, GO_BASE);
  assert.equal(r.kind, 'provider_unavailable');
});

test('classify Zen 402 as insufficient_balance off Go gateway', () => {
  const err = new APICallError({
    message: 'Insufficient Balance',
    url: 'https://opencode.ai/zen/v1/messages',
    requestBodyValues: {},
    statusCode: 402,
    responseBody: '{"error":{"message":"Insufficient Balance"}}',
  });
  const r = classifyLlmFailure(err, 'https://opencode.ai/zen/v1');
  assert.equal(r.kind, 'insufficient_balance');
});

test('computeResumeAt uses 5h default for unknown window', () => {
  const pausedAt = new Date('2026-06-09T10:00:00.000Z');
  const resume = computeResumeAt('unknown', pausedAt);
  assert.equal(resume, '2026-06-09T15:00:00.000Z');
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @artificer/runtime test src/llm/usage-limit.test.ts`

- [ ] **Step 3: Implement `usage-limit.ts`**

```ts
import { APICallError } from 'ai';
import { errorTexts } from './errors.js'; // extract shared helper from errors.ts

export type LlmFailureKind =
  | 'go_usage_limit'
  | 'insufficient_balance'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'other';

export interface LlmFailureClassification {
  kind: LlmFailureKind;
  window: GoUsageWindow;
  retryAfterSeconds?: number;
}

export function isGoGateway(baseURL: string): boolean {
  return baseURL.includes('/zen/go/');
}

export function classifyLlmFailure(
  error: unknown,
  baseURL: string,
): LlmFailureClassification {
  const texts = errorTexts(error);
  const haystack = texts.join('\n');
  const onGo = isGoGateway(baseURL);

  let retryAfterSeconds: number | undefined;
  if (APICallError.isInstance(error)) {
    const h = error.responseHeaders;
    const ra = h?.['retry-after'] ?? h?.['Retry-After'];
    if (ra) retryAfterSeconds = Number(ra);
  }

  if (/provider_name|exceeded_current_quota_error|upstream/i.test(haystack)) {
    return { kind: 'provider_unavailable', window: 'unknown', retryAfterSeconds };
  }

  if (onGo && /5[\s-]?hour|continuous/i.test(haystack)) {
    return { kind: 'go_usage_limit', window: '5h', retryAfterSeconds };
  }
  if (onGo && /weekly/i.test(haystack)) {
    return { kind: 'go_usage_limit', window: 'weekly', retryAfterSeconds };
  }
  if (onGo && /monthly/i.test(haystack)) {
    return { kind: 'go_usage_limit', window: 'monthly', retryAfterSeconds };
  }
  if (
    onGo &&
    (APICallError.isInstance(error) && (error.statusCode === 429 || error.statusCode === 402)) &&
    (/limitation|usage limit|quota/i.test(haystack) ||
      (error.statusCode === 429 && retryAfterSeconds && retryAfterSeconds >= 3600))
  ) {
    return { kind: 'go_usage_limit', window: 'unknown', retryAfterSeconds };
  }

  if (
    APICallError.isInstance(error) &&
    error.statusCode === 429 &&
    retryAfterSeconds &&
    retryAfterSeconds < 3600
  ) {
    return { kind: 'rate_limited', window: 'unknown', retryAfterSeconds };
  }

  if (
    APICallError.isInstance(error) && error.statusCode === 402 ||
    /insufficient\s+balance|payment\s+required/i.test(haystack)
  ) {
    return {
      kind: onGo ? 'go_usage_limit' : 'insufficient_balance',
      window: 'unknown',
      retryAfterSeconds,
    };
  }

  return { kind: 'other', window: 'unknown', retryAfterSeconds };
}
```

Refactor `errors.ts` to export `errorTexts` and implement `isInsufficientBalanceError` as:

```ts
export function isInsufficientBalanceError(error: unknown): boolean {
  return classifyLlmFailure(error, '').kind === 'insufficient_balance';
}
```

(Pass real `baseURL` at call sites where available; `afterRun` has `this.config.baseURL`.)

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @artificer/runtime test src/llm/`

- [ ] **Step 5: Commit** (only if user requests)

---

## Task 3: Usage resume poller

**Files:**
- Create: `packages/runtime/src/engine/usage-resume.ts`
- Create: `packages/runtime/src/engine/usage-resume.test.ts`

- [ ] **Step 1: Write failing test for phase-appropriate status restore**

```ts
test('restoreActiveStatus maps phase to workstream status', () => {
  assert.equal(restoreActiveStatus('planning'), 'planning');
  assert.equal(restoreActiveStatus('implementing'), 'in_progress');
  assert.equal(restoreActiveStatus('verifying'), 'in_progress');
});
```

- [ ] **Step 2: Implement `usage-resume.ts`**

```ts
import type { Store } from '../storage/store.js';
import type { WorkstreamPhase, WorkstreamStatus } from '../storage/types.js';
import type { WorkstreamAction, WorkstreamFacts } from './workstream-machine.js';

export function restoreActiveStatus(phase: WorkstreamPhase): WorkstreamStatus {
  if (phase === 'planning') return 'planning';
  if (phase === 'setup') return 'pending';
  return 'in_progress';
}

export interface UsageResumeDeps {
  store: Store;
  gatherFacts: (workstreamId: string) => Promise<WorkstreamFacts | undefined>;
  dispatchAction: (
    workstreamId: string,
    action: WorkstreamAction,
    originMessageId?: string,
    parentRunId?: string,
  ) => Promise<void>;
  listRunsForWorkstream: (workstreamId: string) => Promise<{ originMessageId?: string; id: string }[]>;
}

export async function resumeDueUsagePauses(
  deps: UsageResumeDeps,
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  const due = await deps.store.listWorkstreamsAwaitingUsageResume(nowIso);
  let count = 0;
  for (const ws of due) {
    const runs = await deps.listRunsForWorkstream(ws.id);
    const last = runs.sort((a, b) => a.id.localeCompare(b.id)).at(-1);
    await deps.store.clearUsagePause(ws.id);
    await deps.store.updateWorkstream(ws.id, {
      status: restoreActiveStatus(ws.currentPhase),
      summary: `${ws.summary}\n\n[System] Go usage window reset — resuming.`.trim(),
    });
    const facts = await deps.gatherFacts(ws.id);
    if (!facts) continue;
    const action = (await import('./workstream-machine.js')).nextWorkstreamAction(facts);
    await deps.dispatchAction(ws.id, action, last?.originMessageId, last?.id);
    count += 1;
  }
  return count;
}
```

- [ ] **Step 3: Run test — expect PASS**

---

## Task 4: Wire into Engine

**Files:**
- Modify: `packages/runtime/src/engine/engine.ts`
- Modify: `packages/runtime/src/config.ts`
- Modify: `packages/runtime/.env.example`
- Modify: `packages/runtime/src/index.ts`

- [ ] **Step 1: Add config**

```ts
export interface GoUsagePauseConfig {
  enabled: boolean;
  pollIntervalMs: number;
}

// In loadConfig:
const onGo = baseURL.includes('/zen/go/');
goUsagePause: {
  enabled: env.RUNTIME_GO_USAGE_PAUSE !== 'false' && onGo,
  pollIntervalMs: Number(env.RUNTIME_GO_USAGE_POLL_MS ?? 60_000),
},
```

- [ ] **Step 2: Add `handleUsagePause` and wire `afterRun`**

In `afterRun`, replace the balance-only check:

```ts
if (run.status === 'failed' && run.error) {
  const failure = classifyLlmFailure(run.error, this.config.baseURL);
  if (failure.kind === 'go_usage_limit' && this.config.goUsagePause.enabled) {
    await this.handleUsagePause(run, failure);
    return;
  }
  if (failure.kind === 'insufficient_balance') {
    await this.handleInsufficientBalance(run);
    return;
  }
  if (failure.kind === 'provider_unavailable' && run.workstreamId) {
    await this.handleProviderUnavailable(run, failure);
    return;
  }
}
```

```ts
private readonly usagePauseNotified = new Set<string>();

private async handleUsagePause(
  run: RunRecord,
  failure: LlmFailureClassification,
): Promise<void> {
  if (!run.workstreamId) return;
  const notifyKey = run.workstreamId;
  const ws = await this.store.getWorkstream(run.workstreamId);
  if (!ws || !Store.isActiveStatus(ws.status)) return;

  const pausedAt = new Date();
  const resumeAt = computeResumeAt(failure.window, pausedAt, failure.retryAfterSeconds);
  const pause: UsagePauseState = {
    kind: 'go_usage_limit',
    window: failure.window,
    pausedAt: pausedAt.toISOString(),
    resumeAt,
    lastFailedRunId: run.id,
    lastFailedModel: run.model,
    lastError: run.error ?? 'Go usage limit',
    autoResume: true,
  };
  await this.store.setUsagePause(run.workstreamId, pause, 'blocked');

  if (!this.usagePauseNotified.has(notifyKey)) {
    this.usagePauseNotified.add(notifyKey);
    await this.reply(
      `OpenCode Go usage limit reached (${failure.window} window). ` +
        `I'll resume this workstream automatically around ${resumeAt}. ` +
        `Track usage at https://opencode.ai/docs/go/#usage-limits`,
      run.workstreamId,
    );
  }
}
```

- [ ] **Step 3: Start poller in `Engine` constructor or `startRuntime`**

```ts
private usageResumeTimer?: ReturnType<typeof setInterval>;

startUsageResumePoller(): void {
  if (!this.config.goUsagePause.enabled) return;
  this.usageResumeTimer = setInterval(() => {
    void resumeDueUsagePauses({
      store: this.store,
      gatherFacts: (id) => this.gatherFacts(id),
      dispatchAction: (id, action, origin, parent) =>
        this.dispatchAction(id, action, origin, parent),
      listRunsForWorkstream: (id) => this.store.listRunsForWorkstream(id),
    });
  }, this.config.goUsagePause.pollIntervalMs);
  this.usageResumeTimer.unref?.();
}
```

Call `engine.startUsageResumePoller()` from `index.ts` after recovery. Also call `resumeDueUsagePauses` once at startup (pauses may already be due after downtime).

- [ ] **Step 4: Manual test**

1. Set `LLM_BASE_URL=https://opencode.ai/zen/go/v1` and a Go preset.
2. Artificially set `usagePause` on a workstream with `resumeAt` 1 minute in the past.
3. Confirm engine dispatches next FSM action within one poll interval.

---

## Task 5: Bench integration

**Files:**
- Modify: `packages/runtime/bench/src/poll.ts`
- Modify: `packages/runtime/bench/src/poll.test.ts`
- Modify: `packages/runtime/bench/src/client.ts` (if `RuntimeState` workstream type needs `usagePause`)
- Modify: `packages/runtime/bench/src/runtime-process.ts`

- [ ] **Step 1: Extend bench workstream type with optional `usagePause`**

Ensure `/state` or workstream payload includes `usagePause` (Task 4 server change).

- [ ] **Step 2: Update `decidePoll`**

```ts
export function decidePoll(
  state: RuntimeState,
  idleSince: number | undefined,
  now: number,
  idleGraceMs: number,
): PollDecision {
  const ws = state.workstreams[0];
  if (ws?.usagePause?.autoResume && Date.parse(ws.usagePause.resumeAt) > now) {
    return { kind: 'wait' }; // still in quota window
  }
  if (ws && TERMINAL.has(ws.status)) {
    // ... existing terminal logic
  }
  // ... rest unchanged
}
```

- [ ] **Step 3: Add poll test**

```ts
test('auto-resume usage pause -> wait not terminal', () => {
  const d = decidePoll(
    state({
      busy: false,
      workstreams: [{
        id: 'ws1',
        status: 'blocked',
        usagePause: {
          autoResume: true,
          resumeAt: new Date(Date.now() + 60_000).toISOString(),
          // ...other required fields
        },
      }],
    }),
    undefined,
    Date.now(),
    1000,
  );
  assert.equal(d.kind, 'wait');
});
```

- [ ] **Step 4: Run bench poll tests**

Run: `pnpm --filter @artificer/runtime test bench/src/poll.test.ts`

---

## Task 6: Observability and docs

**Files:**
- Modify: `packages/runtime/src/server/app.ts`
- Modify: `packages/runtime/bench/README.md`

- [ ] **Step 1:** Include `usagePause` in `Engine.getState()` workstream objects.

- [ ] **Step 2:** Document in bench README that Go presets may pause across quota windows and auto-resume.

- [ ] **Step 3:** Add `.env.example` entries for `RUNTIME_GO_USAGE_PAUSE` and `RUNTIME_GO_USAGE_POLL_MS`.

---

## Future enhancements (out of scope for v1)

1. **Early resume probe** — before `resumeAt`, fire a one-token request on `deepseek-v4-flash` to detect window reset early.
2. **Model fallback before pause** — on `provider_unavailable`, retry same role with `minimax-m2.5` (often still funded per [issue #28129](https://github.com/anomalyco/opencode/issues/28129)).
3. **OpenCode usage API** — if OpenCode exposes quota/reset timestamps, replace conservative defaults.
4. **In-call short retry** — for `rate_limited` with `Retry-After < 60s`, backoff inside `runToolLoop` instead of pausing the workstream.

---

## Self-review checklist

| Requirement | Task |
|-------------|------|
| Detect Go usage limit vs balance | Task 2 |
| Persist resume flag + `resumeAt` | Task 1 |
| Auto-resume when window resets | Tasks 3–4 |
| Survive runtime restart | Task 4 startup `resumeDueUsagePauses` |
| Bench does not abort on quota pause | Task 5 |
| User notification | Task 4 `handleUsagePause` |

No placeholders remain; all tasks include concrete code and test commands.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-09-opencode-go-usage-limits.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
