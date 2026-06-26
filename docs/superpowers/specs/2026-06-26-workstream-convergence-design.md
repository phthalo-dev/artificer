# Workstream Convergence Fixes

**Date:** 2026-06-26  
**Triggered by:** ws_79d4a32f (P3.25 typestyles/react) — blocked with "not_converging" after planners failed to produce a plan and workers looped without progress.

---

## Problem Summary

Four chained failures caused a "High effort" greenfield package-creation task to block:

1. `PLAN_TASK` prompt is framed for bug fixes ("name the root-cause file and lines") — planners had no natural stopping point for a new-package task and timed out without calling `write_plan`.
2. Subsequent workers received the same generic `IMPLEMENT_DIRECT_TASK` with no knowledge that a prior worker had already created scaffolding files — they re-read what existed instead of completing the gaps.
3. The first worker wrote 8 files but ran out of token budget before calling `report_status` — partial progress was invisible to the engine.
4. `MAX_WORKER_RUNS_BEFORE_REVIEW = 5` allowed three aimless worker runs to accumulate before the no-progress guard fired.

---

## Fix 1 — `PLAN_TASK` prompt branching for greenfield tasks

**File:** `packages/runtime/src/engine/workstream-machine.ts`  
**Change:** Replace the single-mode "find the bug" framing with an explicit branch:

- **Bug fix / change to existing code:** read the relevant file(s), grep for the symbol, name the root-cause file and lines, the exact change, and the verify command.
- **New feature / new package:** list each file to create, its purpose, the key APIs and their signatures, dependencies on existing packages, and how to verify (build command, test command, or smoke test).

In both cases the planner must call `write_plan` immediately once it has enough information. The key addition is that "enough information" is now well-defined for feature tasks, removing the open-ended exploration loop.

---

## Fix 2 — Prior worker context injected into task descriptions

**File:** `packages/runtime/src/engine/engine.ts`  
**Change:** When dispatching a worker and `workSinceLastReview > 0`, append a "Prior work in this session" section to the task string. For each previous worker run in `workerRunsSinceReview`:

- If the run called `report_status`, include its summary.
- If it did not (token exhaustion), generate a summary of the files it wrote (derived from successful `write_file` tool calls in the run record).

The appended section looks like:
```
Prior work in this session:
- Run 1: Created packages/react/package.json, src/styled.ts, src/css-prop.ts, src/types.ts (no status reported — budget exhausted).
- Run 2: [status summary if reported]
Continue from here rather than re-investigating from scratch.
```

This puts the context burden on the engine (which has the data) rather than the model (which may not look for it).

---

## Fix 3 — Stronger `report_status` enforcement in WORKER system prompt

**File:** `packages/runtime/src/engine/roles.ts`  
**Change:** Move the "call report_status if running low" instruction earlier and make it unconditional on partial edits:

- Add an explicit rule: "Call `report_status` as soon as you have made any file edits, even if the task is incomplete — partial progress reported is never wasted. Do not wait until everything is done."
- Keep the existing "if running low on turns, stop and report" guidance but strengthen it: "If you are running low on remaining turns: stop all investigation immediately and call `report_status` with `status: 'done_with_concerns'`, listing exactly what you changed and what remains. A run that ends without `report_status` is invisible to the orchestrator — it cannot tell what you did."

---

## Fix 4 — Lower `MAX_WORKER_RUNS_BEFORE_REVIEW`

**File:** `packages/runtime/src/engine/workstream-machine.ts`  
**Change:** Reduce `MAX_WORKER_RUNS_BEFORE_REVIEW` from `5` to `3`.

Three worker runs is still enough for a large task to spread work across multiple focused passes before review, but cuts the tail of aimless re-runs when workers are stuck. The value can be tuned upward if large tasks consistently need more accumulation time.

---

## Files Changed

| File | Fixes |
|------|-------|
| `packages/runtime/src/engine/workstream-machine.ts` | Fix 1 (PLAN_TASK text), Fix 4 (MAX_WORKER_RUNS_BEFORE_REVIEW) |
| `packages/runtime/src/engine/engine.ts` | Fix 2 (prior worker context injection) |
| `packages/runtime/src/engine/roles.ts` | Fix 3 (WORKER system prompt) |

No new files. No schema changes. No test-file changes beyond updating existing unit tests for the new constant and prompt text.

---

## Verification

- Existing unit tests in `workstream-machine.test.ts` and `worker-progress.test.ts` must still pass.
- Update the `MAX_WORKER_RUNS_BEFORE_REVIEW` test expectations from 5 → 3.
- Add a test for the prior-work context injection in `engine.test.ts` (or a new `compute-facts.test.ts`): verify that when `workerRunsSinceReview` contains a run with `write_file` calls and no `report_status`, the dispatched task string includes a "Prior work" section naming those files.
- Run `pnpm --filter @artificer/runtime test` to confirm green.
