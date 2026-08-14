# Recall / History Search (`search_history`) — Design Spec

**Date:** 2026-08-13
**Status:** Proposed
**Component:** `packages/runtime`
**Inspiration:** Letta's `conversation_search` tool (see [Letta comparison — independent](../../research/2026-08-12-letta-comparison-independent.md), Tier 1 borrow #1). Not adopting Letta's Postgres-backed recall/archival tiers — this stays file-backed, matching `query_memories`' existing pattern.

## Goal

Let `communicator`, `planner`, and `librarian` answer "what did we do about X" questions grounded in **actual run history** — not just curated long-term memory or the live conversation thread — without adding a database or an unbounded per-call directory scan.

## Problem

Artificer already has two of the three pieces a "recall search" feature needs:

- `query_memories` — searches curated, agent-written long-term memory (`identity/memories/*.md`), ranked via `rankMemories` (`packages/runtime/src/storage/memory-search.ts`).
- `get_recent_messages` (`packages/runtime/src/tools/communication.ts:14`) — searches the outward conversation thread (inbound/outbound `Message`s) via substring match, date range, and pagination.

Neither searches **`RunRecord`s** — the internal `role`/`task`/`output` history of every planner/worker/reviewer/librarian call. This is a real gap: "did the worker already try fixing this in the auth module two weeks ago" or "what did the reviewer say about the last PR to this file" has no answer today short of manually reading `runs/<id>.json` files or workstream chronicles (which only summarize a single workstream's own runs, not run history across workstreams).

`Store.listRuns()` (`packages/runtime/src/storage/store.ts:385`) already does a full unindexed `runs/` directory scan (used as-is by `engine.ts`, `server/app.ts`, `schedule-runner-host.ts`) and there is no run retention/pruning policy anywhere in the codebase — run count only grows. A naive "scan and substring-match every run file per search call" implementation would read every `RunRecord`, including its full `toolCalls` array, on every query — increasingly expensive as an agent accumulates history, and a needless read of data (tool call bodies) the feature doesn't need.

## Constraints (must preserve)

- **File-backed, no database.** Same as everything else in `Store`.
- **Pull-only.** No auto-injection into context — this is a tool the model calls, like `query_memories`. No signpost is added for it (unlike memories, run history isn't curated content worth advertising passively; it's a lookup tool for when the model already suspects something happened before).
- **Single ranking chokepoint per data type**, matching the existing convention: `rankMemories` is the only place memory scoring lives; this adds one equivalent, `rankRuns`, as the only place run-history scoring lives. They are not unified into one function — messages, memories, and runs are different shapes with different fields.
- **`get_recent_messages` is untouched.** Out of scope for this spec (see Non-goals).
- **Fire-and-forget, best-effort indexing**, consistent with the rest of `Store`'s memory-write path (see "Accepted limitation" below) — indexing must never fail or delay a run's own save.

## Non-goals

- Searching `toolCalls` bodies. Out of scope — that's what tool-result spill / `read_tool_result` exist for, and indexing full trajectories would bloat the index and risk surfacing spilled/secret-adjacent content through a general-purpose search tool.
- Upgrading `get_recent_messages` to ranked/fuzzy matching. A real, separate idea, deliberately out of scope here (confirmed with the user — this spec is run-records-only).
- A unified messages+runs search tool. Same reason.
- Embeddings / semantic search. v1 is pure lexical (Fuse.js), matching `query_memories`' default behavior. An embedding hybrid could follow later exactly the way `memory-embeddings.ts` does for memories, if lexical search proves insufficient in practice.
- Run retention or pruning. This spec makes *search* cheap regardless of run count; it doesn't address unbounded `runs/` directory growth, which is a pre-existing condition unrelated to this feature.
- A "fetch full run by id" drill-down tool. Excerpts are the entire interface for v1. If a real need for full-trajectory drill-down surfaces later, that's a natural, separate follow-up (the excerpt always contains an `id` field, so nothing here forecloses adding it).
- Worker/reviewer access. Confirmed scope: `communicator`, `planner`, `librarian` only, mirroring `query_memories`' current role list minus `worker`/`reviewer` (see "Role access" below for the reasoning).

---

## Architecture

```
RunRecord written (createRun / saveRun)
        │
        ▼
Store.saveRun()  ──status done/failed?──▶  upsert RunIndexEntry into history/index.json
        │ (queued/running: no-op)
        ▼
runs/<id>.json  (unchanged — full record, source of truth)


search_history tool ──▶ Store.searchHistory(query, opts)
                              │
                              ├─ read history/index.json (rebuild from runs/ scan if unreadable)
                              ├─ optional filter: role, workstreamId, status
                              └─ rankRuns(query, entries) → top N → format
```

### New files

- `packages/runtime/src/storage/history-search.ts` — `RunIndexEntry` type + `rankRuns()`. Structurally mirrors `memory-search.ts`.
- `packages/runtime/src/tools/history.ts` — `createHistoryTools(ctx)`, exposing the `search_history` tool. Structurally mirrors how `query_memories` is defined in `orchestrator-tool.ts`.

### Modified files

- `packages/runtime/src/storage/layout.ts` — add `historyDir` and `historyIndexFile()`.
- `packages/runtime/src/storage/store.ts` — add `searchHistory()`, and index-maintenance logic invoked from the existing `saveRun()`.
- `packages/runtime/src/tools/registry.ts` — wire `search_history` into `communicator`, `planner`, `librarian`.

### Index location — a new top-level directory, not `runs/index.json`

Memories put their index inside `memoriesDir` (`memories/index.json`), and `listMemories()` explicitly excludes `index.json` when scanning that directory. `listRuns()` has **no such exclusion** — it calls `listJson<RunRecord>(runsDir)`, which globs every `*.json` file in the directory and parses each as a `RunRecord`. Putting the history index inside `runsDir` would silently corrupt every existing `listRuns()` call site (`engine.ts`, `server/app.ts`, `schedule-runner-host.ts`) by feeding them a malformed pseudo-run. To avoid touching that unrelated, already-relied-upon code path at all, the history index lives in its own directory: `<execDir>/history/index.json`.

## Data model

```ts
// packages/runtime/src/storage/history-search.ts

export interface RunIndexEntry {
  id: string;                 // RunRecord.id
  role: string;
  status: 'done' | 'failed';  // only terminal runs are indexed
  workstreamId?: string;
  model?: string;
  /** First ~200 chars of RunRecord.task. */
  taskExcerpt: string;
  /** First ~300 chars of RunRecord.output (or error, if failed and output is empty). */
  outputExcerpt: string;
  createdAt: string;
}
```

Excerpting happens once, at index-write time, from the full `RunRecord` — the index never needs to re-read `runs/<id>.json` to serve a search. `toolCalls` and `usage` are never copied into the index.

### Ranking

```ts
const FUSE_KEYS = [
  { name: 'taskExcerpt', weight: 0.6 },
  { name: 'outputExcerpt', weight: 0.4 },
];
```

No tag boost (runs have no tags). `rankRuns(query, entries)` reuses the same `tokenize()` helper `memory-search.ts` already exports (stopword/short-token filtering), same empty-query-returns-recency-order fallback, same Fuse threshold (0.4) for consistency with how `query_memories` already behaves — an agent that's learned one tool's recall quality shouldn't have to relearn the other's.

## Index maintenance

### Why hook into `saveRun()`, not `createRun()`

`saveRun()` is called multiple times across a run's life (`packages/runtime/src/engine/call.ts:249,373,384,392`): once when a call starts (`status: 'running'`), fire-and-forget mid-run for resumability, and once at the terminal transition (`status: 'done'` or `'failed'`). Indexing only matters at that terminal point — `output` isn't populated yet on the earlier saves, and indexing a call that's still in flight would be indexing content that doesn't exist yet.

`Store.saveRun()` checks `run.status` and, only for `'done'`/`'failed'`, upserts one `RunIndexEntry` into `history/index.json` (read-modify-write, matching the same `writeJsonAtomic`/per-file write-chain the rest of `Store` already uses). For `'queued'`/`'running'` saves, this is a no-op — `saveRun()`'s existing behavior for the run file itself is unchanged either way.

This mirrors `addMemory()` owning its own index maintenance internally, so no call site can forget to index a run — it's not possible to call `saveRun()` with a terminal status and skip indexing.

### Self-healing, and why it's simpler than the memory index's

The memory index (`Store.readReconciledIndex()`) does two things: (1) rebuild if `index.json` is missing or fails to parse, and (2) rebuild if the entry count drifts from the actual file count on disk — because memory files can be added/removed outside `addMemory()` (a user hand-editing the identity repo, a `git pull` bringing in memories written elsewhere).

Runs have no such external-mutation path — `runs/` is written exclusively by `Store.createRun()`/`saveRun()`, never hand-edited, never git-synced. So the history index only needs case (1): if `history/index.json` is missing or unparseable, rebuild it by scanning `runs/` (`listRuns()`), filtering to `status ∈ {'done', 'failed'}`, and excerpting each. No drift-count check is needed or implemented — there's nothing external that could cause silent drift.

### Accepted limitation

Writing the run file and upserting the index entry are two separate writes, not one atomic transaction. If the process crashes in the narrow window between them, that one run's index entry is permanently missed (the run file itself is never lost — it's just unindexed). This is consistent with `Store`'s existing best-effort-write posture elsewhere (memory/git writes are already documented as fire-and-forget, never blocking orchestration) and isn't worth engineering around: the cost of a rare missed index entry is "one old run doesn't show up in search," not data loss.

## `search_history` tool

```ts
search_history(
  query?: string,
  opts?: {
    role?: string;           // filter to one role, e.g. "worker"
    workstreamId?: string;   // filter to one workstream
    status?: 'done' | 'failed';
    limit?: number;          // default 5, max 20
  }
): string
```

No `charBudget` parameter — unlike `query_memories`, each result is already a small, fixed-size excerpt (≤200 + ≤300 chars) built at index time, so there's no variable-length content to budget at read time.

Output format mirrors `query_memories`' bulleted style:

```
- [worker] Fix auth redirect loop in login.ts (workstream ws_a1b2c3d4, done)
  Replaced the stale session check with... (output excerpt)
```

Empty query → recency-ordered listing of the most recent indexed runs (same convention `rankMemories`/`query_memories` already use for an empty query).

### Role access

`communicator`, `planner`, `librarian` — added to their existing `byName(orchestrator, [...])` tool lists in `registry.ts`, the same place `query_memories`/`add_memory` are wired per role. `worker` and `reviewer` are mid-task, tool-focused roles scoped tightly to the file/shell/git tools needed to execute or review one task; they don't currently get `get_recent_messages` either, and adding cross-workstream historical lookup to their toolset isn't something either role has asked for — this can be revisited if a concrete case for it shows up.

## Error handling

- Corrupt/missing `history/index.json` → rebuild from `runs/` scan (same fallback shape as `readMemoryIndex()`'s try/catch-and-rebuild).
- `runs/` empty or no terminal runs yet → `search_history` returns `(no run history)`, mirroring `query_memories`' `(no memories)`.
- Invalid `role`/`status` filter values → treated as no match (empty result), not an error — consistent with how `query_memories`' `tags` filter behaves today.

## Testing

- `history-search.test.ts` (new, mirrors `memory-search.test.ts`): `rankRuns` — text ranking, empty-query recency fallback, stopword-only query fallback, no tag-boost path since runs have no tags.
- `store.test.ts` (extend): `saveRun()` indexes on `'done'`/`'failed'`, no-ops on `'queued'`/`'running'`; `searchHistory()` returns matches; corrupt `history/index.json` triggers rebuild from `runs/`; `role`/`workstreamId`/`status` filters.
- `history.test.ts` (new, mirrors the `query_memories` handler tests in `orchestrator-tool.test.ts`): tool wiring, empty-result formatting, output shape.
- Role-registry test (extend existing registry test coverage): `search_history` present for `communicator`/`planner`/`librarian`, absent for `worker`/`reviewer`.

## Open questions for the implementation plan

None outstanding — the design above resolves the scope, indexing strategy, and role-access questions raised during review. The only thing intentionally left to the implementation plan is exact excerpt-length constants (200/300 chars proposed above) and the Fuse threshold (0.4 proposed, matching `memory-search.ts`), which are the kind of tunable constants better pinned down alongside working tests than speculated about in advance.
