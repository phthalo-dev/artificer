# How It Works

This page covers the mental model behind Artificer — what happens when you send the agent a message and how work gets done.

## The orchestration model

Every inbound message triggers a hierarchy of LLM calls. Each call is called a "role". The roles form a tree:

```
inbound message
      │
      ▼
 communicator ── reply ──▶ you
      │  (start / steer / status)
      ▼
 orchestrator ◀────────────────┐  (re-invoked after every child finishes)
   │ invoke_call               │
   ├──▶ planner  ── plan.md ───┤
   ├──▶ worker   ── 1 file ────┤
   └──▶ reviewer ── notes ─────┘
```

- **communicator** — the only role that talks to the outside world; routes intent to orchestrator(s) or replies directly
- **orchestrator** — owns a workstream, dispatches child roles, re-invoked after each child finishes
- **planner** — produces a `plan.md` artifact for the workstream
- **reviewer** — reviews the plan or completed work, records notes
- **worker** — implements a single focused unit of work (usually one file or task)

## Workstreams

A workstream is the fundamental unit of ongoing work. When you send the agent a non-trivial request, here is what happens:

1. The communicator receives your message and decides to start a workstream
2. The orchestrator spawns a planner, which produces a `plan.md`
3. The orchestrator dispatches worker tasks from the plan, one at a time
4. Each worker result is reviewed before the next task begins
5. The workstream completes when all tasks are done and reviewed

Workstream state is stored under `~/.artificer/<agent-name>/workstreams/<id>/`.

## Hash-stable context sections

Planner, worker, and reviewer calls assemble a user message from the task, workstream meta, and volatile sections (findings, recent tasks, git status, prior-run digest, file-cache hints, memory signpost). Each section is hashed (SHA-256, truncated) and snapshotted in `workstreams/<id>/context-sections.json`. When the hash is unchanged, Artificer **replays the exact previous body bytes** so provider prompt caches can hit; it does not replace the section with an “unchanged” stub.

Reviewer calls store git status plus `git diff HEAD` under `git_status_diff`, separate from the planner/worker `git_status` snapshot, so role transitions do not clobber each other. Empty omitted sections are not listed in the footer.

A one-line footer at the **end** of the user message lists which sections changed (`[context sections updated: git_status, findings]`) or says `[context sections: all unchanged]`. The footer is not part of any section hash. Prefix-cache hits are same-role: consecutive `IMPLEMENT_TASK` worker runs share a stable `Your task:` + workstream meta prefix; planner → worker → reviewer already differ in that prefix, so they will not hit a shared prompt-cache prefix even when section bodies replay.

Section formatters must stay deterministic: no `Date.now()`, random IDs, or unstable object-key order inside section bodies. Timestamps that belong on a stored record (workstream status, finding `createdAt`) are fine; generating a new clock reading while formatting is not.

## The identity split

Two things look like "the agent" but serve different purposes:

- **Identity repo** (e.g. `~/atlas/`): config, instructions, custom tools, channel definitions, and agent-written memories. Git-tracked and portable — push it to GitHub, clone it elsewhere, and the agent moves with it.
- **Execution state** (`~/.artificer/<agent-name>/`): messages, workstreams, workspace checkouts, and run logs. Ephemeral — rebuilt from running the agent, not committed to the identity repo.

This split is what makes the agent portable: clone the identity repo anywhere, run `artificer start`, and it picks up with the same configuration and memories.

## Per-call model tiers

Each role picks a model by complexity tier rather than using one model everywhere:

| Role | Default tier |
|---|---|
| communicator | low |
| orchestrator | low |
| planner | medium |
| reviewer | low |
| worker | medium |

Tiers map to model IDs via env vars: `LLM_MODEL_LOW` for low, `LLM_MODEL` for medium, and `LLM_MODEL_HIGH` for high. Override a role's tier with `RUNTIME_TIER_<ROLE>` (e.g. `RUNTIME_TIER_WORKER=medium`).

## Executors

By default, the worker role uses Artificer's internal LLM tool loop. You can swap it for any MCP-compatible CLI agent — Claude Code, Cursor, Qwen Code — using the `executor` block in `artificer.config.json`. The other roles (communicator, orchestrator, planner, reviewer) always use the internal loop.

## Next steps

- [Quickstart](../getting-started/quickstart.md) — run the agent for the first time
- [Core concepts](../getting-started/core-concepts.md) — workstreams, roles, and storage in more detail
- [Roles reference](../reference/roles.md) — full reference for each role and its configuration
