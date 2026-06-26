# Workstream Auto-Memory — Design Spec

**Date:** 2026-06-25

## Goal

Automatically create and maintain an identity memory for every workstream so
the runtime can recall what work was done, how it went, and why it ended.

A memory is created when a workstream starts, updated at each meaningful
checkpoint during execution, and finalized when the workstream reaches any
terminal state (`done`, `blocked`, `failed`, `cancelled`).

---

## New Components

### `IdentityStore.updateMemory(id, patch)`

New method on the existing `IdentityStore`. Accepts an id and a partial patch
`{ content?, title?, summary?, tags? }`. Reads the existing markdown file,
merges the patch fields, writes it back, and rebuilds the index. Returns the
updated `Memory`, or `null` if the id is not found.

### `Layout.workstreamMemoryRefFile(workstreamId)`

New path helper: `workstreams/{id}/memory-ref.txt`. Stores the identity memory
ID for a given workstream. Written once on creation, read on every subsequent
update. Lives in the Store's data directory alongside the workstream so it
survives restarts.

### `WorkstreamMemoryService`

**File:** `packages/runtime/src/engine/workstream-memory.ts`

**Constructor:** `(identity: IdentityStore, store: Store)`

Owns all "what to remember" logic. All public methods are fire-and-forget —
they catch their own errors so a memory write failure never interrupts
orchestration.

#### Methods

| Method | Trigger | Content written |
|--------|---------|-----------------|
| `onCreated(ws)` | Workstream created | Creates memory: title = workstream title, content = goal + status line, tags = `['workstream', status]` + repo name slug if repoUrl present, kind = `'document'`, source = `workstream:{id}`. Saves memory ID to sidecar. |
| `onPlanWritten(ws, plan)` | Planner run finishes with a plan | Appends `## Plan\n{first 1000 chars of plan}` to content, updates summary. |
| `onWorkerRunFinished(ws, run)` | Worker run finishes with status `done` | Appends `## Worker Run ({timestamp})\n{workerRunSummary or first 500 chars of run.output}`. |
| `onReviewCompleted(ws, review)` | Reviewer run finishes with status `done` | Appends `## Review ({stage})\nOutcome: {approved/rejected} — {first 300 chars of notes}`. |
| `onTerminal(ws)` | Any terminal state reached | Appends `## Outcome\nStatus: {status}\n{ws.summary}`, updates memory summary to workstream summary. |

#### Private helpers

- `getMemoryId(workstreamId)` — reads sidecar, returns id or null
- `saveMemoryId(workstreamId, memoryId)` — writes sidecar
- `appendToMemory(workstreamId, section)` — reads current memory content, appends section, calls `identity.updateMemory`

---

## Engine Changes (`engine/engine.ts`)

**Constructor** gains an optional third parameter: `memoryService?: WorkstreamMemoryService`.

**Call sites:**

| Location in engine.ts | Method called |
|-----------------------|--------------|
| `startWorkstream` and `createDirectWorkstream` — after `store.createWorkstream` | `memoryService?.onCreated(ws)` |
| `afterRun` — when `run.role === 'planner'` and plan was written | `memoryService?.onPlanWritten(ws, plan)` |
| `afterRun` — when `run.role === 'worker'` and `run.status === 'done'` | `memoryService?.onWorkerRunFinished(ws, run)` |
| `afterRun` — when `run.role === 'reviewer'` and `run.status === 'done'` | `memoryService?.onReviewCompleted(ws, review)` |
| `stepWorkstream` `case 'done'`, `blockWorkstream`, `cancelWorkstream` | `memoryService?.onTerminal(ws)` |

All calls use `void` (fire-and-forget at the call site).

---

## `createRuntime` Changes

After `identity` is initialised, construct the service and pass it to the Engine:

```ts
const memoryService = new WorkstreamMemoryService(identity, store);
const engine = new Engine(config, store, memoryService);
```

---

## Data Flow

```
Workstream created
  └─ WorkstreamMemoryService.onCreated(ws)
       └─ identity.addMemory(...)
            └─ writes identity/memories/{id}.md
       └─ store writes workstreams/{id}/memory-ref.txt

Plan written
  └─ WorkstreamMemoryService.onPlanWritten(ws, plan)
       └─ identity.updateMemory(id, { content: existing + plan section })

Worker run done
  └─ WorkstreamMemoryService.onWorkerRunFinished(ws, run)
       └─ identity.updateMemory(id, { content: existing + run section })

Review done
  └─ WorkstreamMemoryService.onReviewCompleted(ws, review)
       └─ identity.updateMemory(id, { content: existing + review section })

Terminal state (done/blocked/failed/cancelled)
  └─ WorkstreamMemoryService.onTerminal(ws)
       └─ identity.updateMemory(id, { content: existing + outcome section,
                                       summary: ws.summary })
```

---

## Error Handling

All `WorkstreamMemoryService` methods catch errors internally and log them
(`console.error`). A failed memory write never throws, never retries, and never
blocks the workstream from proceeding.

---

## Out of Scope

- Deduplicating updates if the same event fires twice (idempotency).
- Memory size limits / truncation of very long workstream histories.
- Exposing per-workstream memory in the UI (the memories appear in the existing Memories page already).
