# Workstream Progress Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the workstream state machine's retry/attempt counters (review cycles, worker runs since review, no-progress repeats, consecutive failed runs, planner attempts, total runs) on the workstream detail page in the UI, so a person watching a workstream can see "2 of 3 review cycles" the same way Ralph Wiggum-style loops make their iteration count an operator-visible number, instead of the counters being invisible until the workstream is already `blocked`.

**Architecture:** The counters already exist and already gate behavior — `nextWorkstreamAction` in `packages/runtime/src/engine/workstream-machine.ts:20-37` defines the caps (`MAX_REVIEW_CYCLES`, `MAX_WORKER_RUNS_BEFORE_REVIEW`, `MAX_FAILED_RUNS`, `MAX_PLANNER_ATTEMPTS`), and `worker-progress.ts` exports `MAX_NO_PROGRESS_REPEATS`/`countNoProgressRepeats`. The current counts are computed inline in `Engine.computeFacts` (`engine/engine.ts:977-1053`), which is private and entangled with FSM-only concerns (`repoDir`, `patchPresent`, `prSubmitted`). Rather than touch that method, this plan adds a small, independently-tested pure function that derives just the five counters from the same raw records (`Review[]`, `RunRecord[]`, whether a plan exists) already returned by the existing `GET /workstreams/:id` handler, and renders them as badges in the UI.

**Tech Stack:** TypeScript (runtime engine + server), React/TSX (UI, using the existing `ds` design-system components).

## Global Constraints

- **Deliberate duplication, stated explicitly:** this plan does not refactor `Engine.computeFacts` — that method drives the production dispatch loop and touching it for a read-only UI feature is disproportionate risk. The new pure function in Task 1 independently re-derives the same five numbers from the same raw inputs. Task 1's file carries a comment cross-referencing `engine.ts`'s `computeFacts`, and `computeFacts` carries a reciprocal comment pointing back — so an edit on either side is a prompt to check the other. (Correction from the final review: Task 1's tests only pin `computeRetryCounters`'s own behavior — they cannot detect `computeFacts` drifting elsewhere, since nothing in the suite reads `computeFacts` at all. The reciprocal comments are the actual, and only, drift mitigation; treat them as load-bearing, not decorative.)
- Counter caps come from the exported constants already in `workstream-machine.ts` and `worker-progress.ts` — never hardcode `3` or `2` a second time.
- The UI only renders a counter once it's non-zero (a fresh workstream showing "0 of 3" for five different counters is noise, not signal).
- No new dependencies in either package.

---

### Task 1: Pure retry-counter derivation + tests

**Files:**
- Create: `packages/runtime/src/engine/workstream-retry-counters.ts`
- Create: `packages/runtime/src/engine/workstream-retry-counters.test.ts`

**Interfaces:**
- Consumes: `Review`, `RunRecord` types from `packages/runtime/src/storage/types.ts` (existing); `countNoProgressRepeats` from `./worker-progress.js` (existing, unchanged).
- Produces: `computeRetryCounters(hasPlan: boolean, reviews: Review[], wsRuns: RunRecord[]): RetryCounters`, consumed by Task 2 (server route) and indirectly by Task 3 (UI type mirrors `RetryCounters`' shape).

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/engine/workstream-retry-counters.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeRetryCounters } from './workstream-retry-counters.js';
import type { Review, RunRecord } from '../storage/types.js';

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: overrides.id ?? `run-${Math.random()}`,
    role: 'worker',
    task: 'do the thing',
    status: 'done',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 0,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: overrides.id ?? `review-${Math.random()}`,
    workstreamId: 'ws-1',
    target: 'work',
    notes: '',
    approved: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('no runs or reviews yields all-zero counters', () => {
  const counters = computeRetryCounters(true, [], []);
  assert.deepEqual(counters, {
    reviewCount: 0,
    workSinceLastReview: 0,
    noProgressRepeats: 0,
    consecutiveFailedRuns: 0,
    plannerRunsWithoutPlan: 0,
    totalRuns: 0,
  });
});

test('workSinceLastReview only counts done worker runs after the latest review', () => {
  const reviews = [review({ id: 'r1', createdAt: '2026-01-01T00:10:00.000Z' })];
  const runs = [
    run({ id: 'w0', createdAt: '2026-01-01T00:05:00.000Z' }), // before the review
    run({ id: 'w1', createdAt: '2026-01-01T00:20:00.000Z' }),
    run({ id: 'w2', createdAt: '2026-01-01T00:30:00.000Z' }),
    run({ id: 'planner', role: 'planner', createdAt: '2026-01-01T00:25:00.000Z' }), // not a worker run
  ];
  const counters = computeRetryCounters(true, reviews, runs);
  assert.equal(counters.workSinceLastReview, 2);
  assert.equal(counters.reviewCount, 1);
});

test('consecutiveFailedRuns counts only the trailing run of failures', () => {
  const runs = [
    run({ id: 'a', status: 'failed', createdAt: '2026-01-01T00:01:00.000Z' }),
    run({ id: 'b', status: 'done', createdAt: '2026-01-01T00:02:00.000Z' }),
    run({ id: 'c', status: 'failed', createdAt: '2026-01-01T00:03:00.000Z' }),
    run({ id: 'd', status: 'failed', createdAt: '2026-01-01T00:04:00.000Z' }),
  ];
  const counters = computeRetryCounters(true, [], runs);
  assert.equal(counters.consecutiveFailedRuns, 2);
});

test('plannerRunsWithoutPlan is 0 once a plan exists, regardless of prior planner runs', () => {
  const runs = [
    run({ id: 'p1', role: 'planner', createdAt: '2026-01-01T00:01:00.000Z' }),
    run({ id: 'p2', role: 'planner', createdAt: '2026-01-01T00:02:00.000Z' }),
  ];
  assert.equal(computeRetryCounters(false, [], runs).plannerRunsWithoutPlan, 2);
  assert.equal(computeRetryCounters(true, [], runs).plannerRunsWithoutPlan, 0);
});

test('totalRuns counts every run regardless of role or status', () => {
  const runs = [
    run({ id: 'a', role: 'planner' }),
    run({ id: 'b', role: 'worker', status: 'failed' }),
    run({ id: 'c', role: 'reviewer' }),
  ];
  assert.equal(computeRetryCounters(true, [], runs).totalRuns, 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/runtime && pnpm exec tsx --test src/engine/workstream-retry-counters.test.ts
```

Expected: FAIL — `workstream-retry-counters.js` does not exist (module not found).

- [ ] **Step 3: Write the implementation**

Create `packages/runtime/src/engine/workstream-retry-counters.ts`:

```ts
import type { Review, RunRecord } from '../storage/types.js';
import { countNoProgressRepeats } from './worker-progress.js';

export interface RetryCounters {
  /** Total reviews recorded (plan + work stages combined). */
  reviewCount: number;
  /** Done worker runs since the most recent review. */
  workSinceLastReview: number;
  /** Trailing worker runs since the last review that made no progress. */
  noProgressRepeats: number;
  /** Trailing run of consecutive failed runs, most-recent-first. */
  consecutiveFailedRuns: number;
  /** Completed planner runs so far, only counted while no plan exists yet. */
  plannerRunsWithoutPlan: number;
  /** Every run in the workstream, any role or status. */
  totalRuns: number;
}

/**
 * Independently re-derives the same five counters `Engine.computeFacts`
 * (packages/runtime/src/engine/engine.ts) computes for the state machine,
 * from the same raw records. Kept separate (not extracted from computeFacts)
 * because computeFacts is on the hot dispatch path and also computes
 * FSM-only concerns (repoDir, patchPresent, prSubmitted) this doesn't need —
 * see this plan's Global Constraints. If you change how a counter is
 * computed here, check engine.ts's computeFacts for the same drift.
 */
export function computeRetryCounters(
  hasPlan: boolean,
  reviews: Review[],
  wsRuns: RunRecord[],
): RetryCounters {
  const sortedReviews = [...reviews].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const lastReview = sortedReviews.at(-1);

  const workerRunsSinceReview = wsRuns
    .filter(
      (r) =>
        r.role === 'worker' &&
        r.status === 'done' &&
        (!lastReview || r.createdAt > lastReview.createdAt),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const ordered = [...wsRuns].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  let consecutiveFailedRuns = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (ordered[i].status === 'failed') consecutiveFailedRuns += 1;
    else break;
  }

  return {
    reviewCount: sortedReviews.length,
    workSinceLastReview: workerRunsSinceReview.length,
    noProgressRepeats: countNoProgressRepeats(workerRunsSinceReview),
    consecutiveFailedRuns,
    plannerRunsWithoutPlan: hasPlan
      ? 0
      : wsRuns.filter((r) => r.role === 'planner' && r.status === 'done')
          .length,
    totalRuns: wsRuns.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/runtime && pnpm exec tsx --test src/engine/workstream-retry-counters.test.ts
```

Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/workstream-retry-counters.ts packages/runtime/src/engine/workstream-retry-counters.test.ts
git commit -m "engine: add pure workstream retry-counter derivation"
```

---

### Task 2: Attach progress to `GET /workstreams/:id`

**Files:**
- Modify: `packages/runtime/src/server/app.ts`
- Modify: `packages/runtime/src/server/workstreams.test.ts`

**Interfaces:**
- Consumes: `computeRetryCounters` from Task 1; `MAX_REVIEW_CYCLES`, `MAX_WORKER_RUNS_BEFORE_REVIEW`, `MAX_FAILED_RUNS`, `MAX_PLANNER_ATTEMPTS` from `../engine/workstream-machine.js` (existing exports); `MAX_NO_PROGRESS_REPEATS` from `../engine/worker-progress.js` (existing export); `engine.config.maxRunsPerWorkstream` (existing public readonly field, confirmed at `engine/engine.ts:104`).
- Produces: a `progress` field on the `GET /workstreams/:id` JSON response, of the shape defined in Step 1, consumed by Task 3's UI type.

- [ ] **Step 1: Write the failing test**

Add to `packages/runtime/src/server/workstreams.test.ts` (append; keep the existing `buildApp` helper):

```ts
test('GET /workstreams/:id includes retry-counter progress with caps', async () => {
  const { app, store } = await buildApp();

  const res = await app.request('/api/workstreams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'progress test',
      goal: 'Do a thing',
      autostart: false,
    }),
  });
  const { workstreamId } = (await res.json()) as { workstreamId: string };

  await store.createReview({
    workstreamId,
    target: 'work',
    stage: 'work',
    approved: false,
    notes: 'not quite',
  });

  const detailRes = await app.request(`/api/workstreams/${workstreamId}`);
  assert.equal(detailRes.status, 200);
  const body = (await detailRes.json()) as {
    progress: {
      reviewCycles: { count: number; max: number };
      workerRunsSinceReview: { count: number; max: number };
      noProgressRepeats: { count: number; max: number };
      consecutiveFailedRuns: { count: number; max: number };
      plannerAttempts: { count: number; max: number };
      totalRuns: { count: number; max: number };
    };
  };

  assert.equal(body.progress.reviewCycles.count, 1);
  assert.equal(body.progress.reviewCycles.max, 3);
  assert.equal(body.progress.totalRuns.count, 0);
  assert.ok(body.progress.totalRuns.max > 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/runtime && pnpm exec tsx --test src/server/workstreams.test.ts
```

Expected: FAIL — `body.progress` is `undefined`.

- [ ] **Step 3: Wire the field into the handler**

In `packages/runtime/src/server/app.ts`, add the imports (near the existing engine imports at the top of the file):

```ts
import { computeRetryCounters } from '../engine/workstream-retry-counters.js';
import {
  MAX_REVIEW_CYCLES,
  MAX_WORKER_RUNS_BEFORE_REVIEW,
  MAX_FAILED_RUNS,
  MAX_PLANNER_ATTEMPTS,
} from '../engine/workstream-machine.js';
import { MAX_NO_PROGRESS_REPEATS } from '../engine/worker-progress.js';
```

Then change the `GET /workstreams/:id` handler:

```ts
  api.get('/workstreams/:id', async (c) => {
    const id = c.req.param('id');
    const workstream = await engine.store.getWorkstream(id);
    if (!workstream) return c.json({ error: 'not found' }, 404);
    const [tasks, reviews, plan, runs] = await Promise.all([
      engine.store.listTasks(id),
      engine.store.listReviews(id),
      engine.store.readPlan(id),
      engine.store.listRunsForWorkstream(id),
    ]);
    const usage = {
      total: summarize(runs),
      byTask: groupBy(runs, (r) => r.taskId),
      byRole: summarizeByRole(runs),
    };
    const retry = computeRetryCounters(Boolean(plan), reviews, runs);
    const progress = {
      reviewCycles: { count: retry.reviewCount, max: MAX_REVIEW_CYCLES },
      workerRunsSinceReview: {
        count: retry.workSinceLastReview,
        max: MAX_WORKER_RUNS_BEFORE_REVIEW,
      },
      noProgressRepeats: {
        count: retry.noProgressRepeats,
        max: MAX_NO_PROGRESS_REPEATS,
      },
      consecutiveFailedRuns: {
        count: retry.consecutiveFailedRuns,
        max: MAX_FAILED_RUNS,
      },
      plannerAttempts: {
        count: retry.plannerRunsWithoutPlan,
        max: MAX_PLANNER_ATTEMPTS,
      },
      totalRuns: {
        count: retry.totalRuns,
        max: engine.config.maxRunsPerWorkstream,
      },
    };
    return c.json({
      workstream,
      tasks,
      reviews,
      plan,
      runs,
      usage,
      progress,
      tree: buildCallTree(runs),
    });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/runtime && pnpm exec tsx --test src/server/workstreams.test.ts
```

Expected: PASS, including the new test.

- [ ] **Step 5: Type-check and full runtime test suite**

```bash
cd packages/runtime && pnpm exec tsc --noEmit -p . && pnpm test
```

Expected: no errors, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/server/app.ts packages/runtime/src/server/workstreams.test.ts
git commit -m "api: expose retry-counter progress on GET /workstreams/:id"
```

---

### Task 3: UI type and progress badges component

**Files:**
- Modify: `packages/ui/src/api/types.ts`
- Create: `packages/ui/src/components/WorkstreamProgress.tsx`

**Interfaces:**
- Consumes: the `progress` field shape from Task 2; `Badge`, `Group`, `Text`, `type BadgeColor` from `../ds` (existing, same imports `StatusBadge.tsx` already uses).
- Produces: `WorkstreamProgress` type and `<WorkstreamProgress progress={...} />` component, consumed by Task 4.

- [ ] **Step 1: Add the type**

In `packages/ui/src/api/types.ts`, add near `WorkstreamDetail`:

```ts
export interface RetryCounter {
  count: number;
  max: number;
}

export interface WorkstreamProgress {
  reviewCycles: RetryCounter;
  workerRunsSinceReview: RetryCounter;
  noProgressRepeats: RetryCounter;
  consecutiveFailedRuns: RetryCounter;
  plannerAttempts: RetryCounter;
  totalRuns: RetryCounter;
}

export interface WorkstreamDetail {
  workstream: Workstream;
  tasks: Task[];
  reviews: Review[];
  plan: string | null;
  runs: RunRecord[];
  tree?: RunNode[];
  progress: WorkstreamProgress;
  usage: {
    total: UsageSummary;
    byTask: Record<string, UsageSummary>;
    byRole: Record<string, UsageSummary>;
  };
}
```

(Replace the existing `WorkstreamDetail` interface in place — it currently lacks `progress`; every other field stays as-is.)

- [ ] **Step 2: Write the component**

Create `packages/ui/src/components/WorkstreamProgress.tsx`:

```tsx
import { Badge, type BadgeColor, Group, Text } from '../ds';
import type { RetryCounter, WorkstreamProgress as Progress } from '../api/types';

const LABELS: Record<keyof Progress, string> = {
  reviewCycles: 'review cycles',
  workerRunsSinceReview: 'worker runs since review',
  noProgressRepeats: 'no-progress repeats',
  consecutiveFailedRuns: 'consecutive failed runs',
  plannerAttempts: 'planner attempts',
  totalRuns: 'total runs',
};

function counterColor(c: RetryCounter): BadgeColor {
  if (c.max <= 0) return 'gray';
  if (c.count >= c.max) return 'red';
  if (c.count >= c.max - 1) return 'orange';
  return 'gray';
}

/**
 * Shows the state machine's retry/attempt counters (see MAX_* constants in
 * packages/runtime/src/engine/workstream-machine.ts and worker-progress.ts)
 * as "N of M" badges, so how close a workstream is to being auto-blocked is
 * visible before it actually blocks.
 */
export function WorkstreamProgress({ progress }: { progress: Progress }) {
  const visible = (Object.keys(progress) as Array<keyof Progress>).filter(
    (key) => progress[key].count > 0,
  );
  if (visible.length === 0) return null;

  return (
    <Group gap="xs" wrap="wrap">
      {visible.map((key) => {
        const c = progress[key];
        return (
          <Badge key={key} color={counterColor(c)} variant="light">
            {LABELS[key]}: {c.count} of {c.max}
          </Badge>
        );
      })}
    </Group>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd packages/ui && pnpm exec tsc --noEmit -p .
```

Expected: no errors. (`WorkstreamDetail` gained a required `progress` field — this will surface any other place in the UI that constructs a `WorkstreamDetail` by hand; if the type-check flags one, add a `progress` value there too using the same shape as Task 2's response.)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/api/types.ts packages/ui/src/components/WorkstreamProgress.tsx
git commit -m "ui: add WorkstreamProgress badges and progress type"
```

---

### Task 4: Render it on the workstream detail page

**Files:**
- Modify: `packages/ui/src/pages/WorkstreamDetailPage.tsx`

**Interfaces:**
- Consumes: `WorkstreamProgress` component from Task 3; `data.progress` from the existing `useWorkstream(id)` query (`const { data, isLoading, error } = useWorkstream(id);` at line 79 — `data` is the `WorkstreamDetail` from Task 2/3, already fetched by this page).
- Produces: nothing further consumed — last task in this plan.

- [ ] **Step 1: Import the component**

In `packages/ui/src/pages/WorkstreamDetailPage.tsx`, add to the imports:

```ts
import { WorkstreamProgress } from '../components/WorkstreamProgress';
```

- [ ] **Step 2: Render it below the title/status row**

Find this block (around line 130):

```tsx
        <Group gap="sm" align="center">
          <Title order={2}>{ws.title}</Title>
          <StatusBadge status={ws.status} />
          {!TERMINAL_STATUSES.has(ws.status) && (
            <Button
              variant="outline"
              size="sm"
              loading={cancel.isPending}
              onPress={() => cancel.mutate()}
              style={{
                color: color.red,
                borderColor: color.red,
              }}
            >
              Stop
            </Button>
          )}
        </Group>
```

Add the progress badges directly after its closing `</Group>`, before the goal `<Text>`:

```tsx
        </Group>
        {data?.progress && <WorkstreamProgress progress={data.progress} />}
        <Text c="dimmed" size="sm" mt={4} preWrap>
```

(This replaces the line `<Text c="dimmed" size="sm" mt={4} preWrap>` that already follows the `Group` close — insert the new line between them, don't duplicate the `Text` line.)

- [ ] **Step 3: Type-check**

```bash
cd packages/ui && pnpm exec tsc --noEmit -p .
```

Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
pnpm dev
```

Start a workstream that will hit at least one review rejection (or use an existing one from bench results / a prior run with `~/.artificer/<agent>/workstreams/`), open its detail page at `http://localhost:4100`, and confirm: no badges show for a fresh workstream with no reviews/runs yet; a "review cycles: 1 of 3" (gray) badge appears after one rejected review; the badge turns orange at count `max - 1` and red at count `max`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/WorkstreamDetailPage.tsx
git commit -m "ui: render retry-counter progress on the workstream detail page"
```

## Self-Review Notes

- **Spec coverage:** counter derivation + tests (Task 1), API exposure + tests (Task 2), UI type + component (Task 3), and page wiring + manual verification (Task 4) cover the full path from state-machine constants to a person seeing them.
- **Placeholder scan:** no TBDs; the deliberate-duplication tradeoff (not refactoring `Engine.computeFacts`) is stated as a Global Constraint with a concrete mitigation (tests + cross-referencing comment), not hand-waved.
- **Type consistency:** `RetryCounters` (Task 1, runtime) and `WorkstreamProgress`/`RetryCounter` (Task 3, UI) are two independent types with matching field names by design (runtime and UI are separate packages with no shared type import) — the API response shape built in Task 2 is the contract between them; Task 2's test asserts the exact field names (`reviewCycles.count`, `reviewCycles.max`, etc.) that Task 3's type and Task 4's rendering depend on.
