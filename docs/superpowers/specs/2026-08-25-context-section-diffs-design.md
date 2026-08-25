# Context Section Diffs (WorldState-lite) — Design

**Date:** 2026-08-25
**Status:** Approved for planning
**Component:** `packages/runtime` (`engine/call.ts`, new context section helpers)
**Related:**
- [Artificer vs. Codex comparison](../../research/2026-08-24-codex-comparison.md) (Tier 1 borrow #4 — Codex WorldState)
- [Artificer vs. opencode comparison](../../research/2026-08-14-opencode-comparison.md) (structured compaction — complementary, not replaced)
- Current assembly: `buildContext` in `engine/call.ts`

## Purpose

Stop rebuilding volatile context sections from scratch in a **cache-hostile** way across consecutive role calls in the same workstream. Introduce light **sectional snapshots**: each section has a stable id, a computed body, and a hash; when the hash is unchanged since the previous call in that workstream, emit the **exact same body bytes** (not a shortened “unchanged” stub) so provider prompt caches can hit on the shared prefix.

## Problem

Every `executeCall` rebuilds a fresh `userMessage` via `buildContext`:

- task, workstream meta
- findings blackboard
- recent completed tasks
- `git status` (+ reviewer diff)
- prior-runs digest
- file-cache hints
- memory signpost

Most of these change slowly. Recomputing is fine; **reordering, timestamp drift, or non-deterministic formatting** busts prompt caches and wastes tokens on identical facts restated differently. Codex WorldState emits fragments only when a section snapshot changes and keeps history incremental. Artificer rebuilds a single user message per call — so the borrow is **hash-stable sectional rendering**, not Codex’s fragment-trait machinery.

## Decisions

- **Scope:** workstream-scoped section snapshots for `planner` | `worker` | `reviewer` only (the `WORK_ROLES` path in `buildContext`). Communicator/librarian calls are out of scope for v1.
- **Omit-when-unchanged is rejected** for v1 — replacing a large section with “unchanged” *alters* the prompt vs the previous call and can bust caches. Prefer **byte-identical replay** of the previous body when hash matches.
- **Hash input** = canonical section body string (UTF-8), SHA-256 hex truncated to 16 chars (short, collision-resistant enough for this use).
- **Persist** snapshots under the workstream dir: `workstreams/<id>/context-sections.json` via `Layout` — survives process restart within the same workstream.
- **No new LLM summarization** in this spec (OpenCode-style Objective/Work State template remains a separate borrow).
- **Plan file** stays pull-only via `read_plan` (not injected into `buildContext`).

## Architecture

```
buildContext(...)
    │
    ├─ stable prefix: task + workstream meta (always computed fresh;
    │     meta formatting must be deterministic — no Date.now() in section bodies)
    │
    └─ for section in [findings, recent_tasks, git_status, prior_runs, file_cache, memory_signpost]:
            body = computeSection(...)
            hash = shortHash(body)
            if store.get(workstreamId, sectionId)?.hash === hash:
                body = store.get(...).body   // exact replay
            else:
                store.set(workstreamId, sectionId, { hash, body, updatedAt })
            append body to userMessage
```

```ts
// packages/runtime/src/engine/context-sections.ts
export type ContextSectionId =
  | 'findings'
  | 'recent_tasks'
  | 'git_status'
  | 'prior_runs'
  | 'file_cache'
  | 'memory_signpost';

export type ContextSectionSnapshot = {
  hash: string;
  body: string;
  updatedAt: string;
};

export type ContextSectionsFile = {
  version: 1;
  sections: Partial<Record<ContextSectionId, ContextSectionSnapshot>>;
};
```

### Section definitions

| Id | Source (existing) | Notes |
|---|---|---|
| `findings` | `findingsBlock` / `store.listFindings` | Deterministic sort by id/createdAt |
| `recent_tasks` | `recentWorkSummary` | Keep last-N fixed; stable ordering |
| `git_status` | `changedFilesSummary` | Normalize paths; avoid volatile porcelain that embeds timestamps |
| `prior_runs` | `buildPriorRunsDigest` | Already somewhat compact; ensure stable ordering of runs |
| `file_cache` | `FileCache.formatHintBlock` | Replay when hint set unchanged |
| `memory_signpost` | `memorySignpost()` | Counts/tags only; already small |

Workstream title/goal/status remain outside the snapshot file but must use deterministic formatting (status enum string, no “as of &lt;time&gt;” unless that time is stored on the workstream record).

### Optional footer (model-facing)

After all sections, append one line when at least one section hash changed this call:

```
[context sections updated: git_status, findings]
```

When none changed:

```
[context sections: all unchanged]
```

This footer **intentionally changes** when updates occur (informs the model). It sits at the **end** of the user message so it does not disturb the cached prefix of section bodies. Document that the footer is excluded from hash inputs.

## Components

| Unit | Path | Responsibility |
|---|---|---|
| Sections module | `engine/context-sections.ts` (new) | Ids, hash, load/save, `renderSection(id, compute)` |
| Layout | `storage/layout.ts` | `contextSectionsFile(workstreamId)` |
| buildContext | `engine/call.ts` | Route WORK_ROLES sections through the helper |
| Tests | `engine/context-sections.test.ts` | Hash stability + replay |

## Testing

- Two computes with identical logical findings → identical body → second call replays stored body (spy on compute skipped or assert store hit).
- Change one finding → only `findings` hash updates; other sections replay.
- Missing/corrupt `context-sections.json` → recompute all, rewrite file.
- No workstreamId → no file IO (non-workstream path unchanged).
- Golden: `git status` fixture produces stable string across calls.

## Docs

- Short note in runtime architecture / contributing docs: context sections are hash-stable; avoid `Date.now()` in section formatters.

## Non-goals

- Porting Codex `ContextualUserFragment` / WorldState traits
- Incremental conversation history (Artificer still one userMessage per call)
- Structured OpenCode compaction template (separate spec if pursued)
- Injecting `plan.md` into context
- Cross-workstream section sharing
- Token-budget truncation of sections (existing digests/microcompact remain responsible)

## Constraints

- Section bodies must be pure functions of store/git/cache state — no entropy.
- Writing `context-sections.json` is best-effort; failure to write must not fail the run (log warning).
- Do not put secrets into section files beyond what already appears in prompts (git status paths, etc.).
- External executor path uses the same `buildContext` — it benefits automatically.
