# Identity-Based Agent Evals

**Date:** 2026-08-11  
**Status:** Approved  
**Component:** `packages/eval`, `packages/cli`, `packages/runtime` (eval-mode flags + UI reader), identity repo convention  
**Related:** [Bench greenfield plan](../plans/2026-08-08-bench-greenfield-suite.md), [Role customization](2026-06-28-role-customization-design.md), [Cost architecture](2026-06-02-runtime-orchestration-cost-architecture-design.md), [Eve comparison / defineEval gap](../../research/2026-06-22-eve-comparison.md)

## Summary

Add **identity-based agent evals**: a customer-owned task suite under `agent/evals/` in the identity repo, a first-class `artificer eval` CLI, and a Benchmark UI that reads results from the agent's execution directory — not from the Artificer monorepo's `packages/runtime/bench/`.

Evals measure **the configured agent** (instructions, roles, tools, memories, presets, quota routes) on **the customer's tasks**, reporting correctness plus Artificer-specific efficiency signals (USD, runs, per-role cost, trajectories).

Public benchmarks (SWE-bench Lite, DeepSWE) remain optional suite packs for power users and maintainers. They are not the product. The product is: *"Did my identity change make my agent better or cheaper on the work I actually care about?"*

## Problem

Today:

1. The Benchmark UI ships in every consumer install but only works when `bench/results/` exists relative to `process.cwd()` — which scaffolded agent projects never have.
2. The bench harness in `packages/runtime/bench/` spawns a **bare runtime** with a temp `ARTIFICER_EXEC_DIR` and default identity (`packages/runtime` cwd). It does not load the customer's identity repo.
3. There is no `artificer eval` command; consumers must clone the Artificer monorepo and run `pnpm bench`.
4. Empty-state copy in the UI points at `packages/runtime` maintainer instructions.

Consumers need a loop that matches how they actually run Artificer:

```
edit identity → artificer eval → see results in UI → commit or revert
```

## Goals

1. **Identity-first** — every eval run loads the agent project root as `ARTIFICER_IDENTITY_DIR` (instructions, roles, tools, skills, config).
2. **Customer-owned tasks** — eval definitions live in `agent/evals/` and are version-controlled with the identity repo.
3. **Consumer DX** — `artificer eval run` from a scaffolded project; no monorepo required.
4. **Artificer metrics** — resolve/pass rate, duration, tokens, USD, LLM runs, per-role cost, call-tree trajectory (reuse existing bench report shapes).
5. **Regression awareness** — compare two eval runs (e.g. before/after an instructions change, or `main` vs branch).
6. **Dogfood examples** — ship example eval packs sourced from the Artificer monorepo so new agents have copy-paste starters.

## Non-goals (v1)

- Running evals against a **remote** cloud Artificer URL (no `--runtime-url` in v1).
- In-UI "click to start eval" (CLI-driven only in v1; UI is read-only viewer + compare).
- LLM-as-judge graders (defer to v2; v1 uses deterministic graders).
- Shipping full SWE-bench Lite (300 tasks) inside the CLI package (optional downloadable pack later).
- Auto-committing identity changes triggered by eval runs.

## Guiding decisions

1. **Reuse the bench driver, don't fork it.** The existing `bench/src` HTTP client, polling, cost collection, patch extraction, and report generation move into `@artificer-ai/eval`. Refactor paths and identity loading; do not rewrite from scratch.
2. **Separate `@artificer-ai/eval` package.** Published for testability; `@artificer-ai/cli` depends on it the same way it depends on `@artificer-ai/runtime`. The monorepo's `pnpm bench` scripts dev-depend on `@artificer-ai/eval` (and may keep thin wrappers under `packages/runtime/bench/`).
3. **Eval artifacts live in exec dir, not identity repo.** Results go to `$ARTIFICER_EXEC_DIR/evals/<run-id>/` so eval outputs never dirty the identity git history.
4. **Hide-until-grade** for fixtures. Same principle as greenfield and SWE-bench: the agent never sees hidden tests or grader scripts.
5. **One runtime per suite.** Spawn a single runtime for the whole suite run; each task gets a fresh workstream and isolated workspace directory. Tear down the runtime when the suite finishes.
6. **Read-only identity during evals.** `RUNTIME_EVAL_MODE=true` disables all identity mutation: no memory writes/distill, no identity git pull/push/auto-commit, no tool-driven edits under the identity tree. Evals must not change the agent's identity — only read it.
7. **Convention over configuration.** `agent/evals/` layout is the contract; suite JSON lists task ids.
8. **Benchmark nav always visible with empty state.** The nav item stays in the sidebar; when there are no results, the page shows onboarding (`artificer eval run`) instead of hiding the route.

---

## Identity repo layout

```
my-agent/
├── artificer.config.json
├── agent/
│   ├── instructions.md
│   ├── roles/
│   ├── tools/
│   ├── skills/
│   └── evals/                          # NEW
│       ├── suites/
│       │   ├── smoke.json              # default quick suite
│       │   └── nightly.json
│       └── tasks/
│           └── <task-id>/
│               ├── eval.json           # task manifest (kind, graders, metadata)
│               ├── prompt.md           # inbound message or workstream goal
│               ├── fixture/            # optional: scaffold, patch context, pin files
│               └── hidden/             # graders only — never sent to the agent
└── .env
```

### `eval.json` (task manifest)

```jsonc
{
  "id": "fix-format-cost-display",
  "title": "Fix cost formatting regression",
  "kind": "repo-patch",
  "tags": ["runtime", "regression"],
  "timeoutMs": 900000,
  "maxRuns": 40,
  "repo": {
    "url": "https://github.com/artificer-ai/artificer.git",
    "baseCommit": "<pinned-sha>",
    "subpath": "packages/runtime"       // optional: agent works in monorepo subdir
  },
  "grade": {
    "type": "shell",
    "command": "pnpm exec tsc --noEmit -p . && node --import tsx --test src/format.test.ts",
    "cwd": "packages/runtime"
  }
}
```

### Suite file (`suites/smoke.json`)

```json
{
  "name": "Smoke",
  "description": "Fast regression checks (<15 min).",
  "taskIds": [
    "status-preset-query",
    "fix-format-cost-display",
    "implement-hello-tool"
  ]
}
```

---

## Task kinds (v1)

| Kind | What the agent does | Grading | Typical use |
|------|---------------------|---------|-------------|
| `message` | Receives `prompt.md` as an inbound message (communicator path) | `hidden/` shell or assertion script inspects outbound messages / run state | Routing, tone, config questions, channel behavior |
| `workstream` | `POST /workstreams` with goal from `prompt.md` (+ optional repo pin in `eval.json`) | Patch + shell tests, or workstream terminal status | Coding tasks, repo fixes, multi-step orchestration |
| `repo-patch` | Same as `workstream` but **requires** a pinned repo + commit; patch extracted and graded | Shell command in repo (unit tests, typecheck) | Regression on customer's own repos or pinned OSS snapshots |
| `greenfield` | Scaffold in `fixture/` is the workspace; agent builds from `prompt.md` | Hidden tests overlaid at grade time (`hidden/` → repo root) | New-feature capability, algorithmic depth |

`repo-patch` is the identity-eval workhorse. `message` evals are cheap and identity-specific (no clone). `greenfield` reuses the existing bench greenfield grader verbatim.

**Mapping to existing bench code:**

| Eval kind | Bench equivalent |
|-----------|------------------|
| `workstream` / `repo-patch` | `run-instance.ts` workstream path |
| `greenfield` | `greenfield.ts` loader + `eval-greenfield.ts` |
| `message` | New: poll until communicator replies; no patch extraction |

---

## Grading (v1)

All graders run **after** the agent finishes, on the host running `artificer eval` (not inside the agent).

| `grade.type` | Behavior |
|--------------|----------|
| `shell` | Run `grade.command` in a sandboxed workdir (patched repo or exec snapshot). Exit 0 = pass. |
| `workstream-status` | Pass if final workstream status is in `grade.expect` (e.g. `["done"]`). |
| `message-contains` | Pass if any outbound message matches `grade.pattern` (regex string). |
| `file-exists` | Pass if path exists relative to **workspace** (e.g. `plan.md`). Not for new identity files — eval mode forbids identity writes. |

Eval report schema matches existing bench `eval-report.json`:

```json
{
  "schema_version": 1,
  "resolved_ids": ["task-a"],
  "unresolved_ids": ["task-b"],
  "empty_patch_ids": [],
  "error_ids": [],
  "completed_ids": ["task-a", "task-b"]
}
```

`attempts.json`, `predictions.jsonl` (for patch kinds), `run-config.json`, `report.json`, and per-task `runs/<id>.json` trajectories reuse existing shapes so the UI needs minimal changes.

---

## CLI

```bash
# Run default suite (agent/evals/suites/smoke.json)
artificer eval run

# Named suite
artificer eval run --suite nightly

# Single task
artificer eval run --task fix-format-cost-display

# Pin preset for reproducibility (overrides .env for eval only)
artificer eval run --preset quality-first

# Compare latest run to previous (or explicit run ids)
artificer eval compare
artificer eval compare runs/2026-08-11T12-00-00 runs/2026-08-11T09-00-00

# List suites / tasks
artificer eval list
```

**Package layout:**

```
packages/eval/          → @artificer-ai/eval (driver, graders, report; unit-testable)
packages/cli/           → artificer eval * (thin wrapper over @artificer-ai/eval)
packages/runtime/       → RUNTIME_EVAL_MODE, UI bench reader, engine identity guards
```

`@artificer-ai/cli` adds `@artificer-ai/eval` as a dependency alongside `@artificer-ai/runtime`, mirroring the existing CLI → runtime relationship.

**Runtime spawn (v1):** the eval driver spawns **one** local runtime per suite run:

```bash
ARTIFICER_IDENTITY_DIR=<agent-project-root>   # read-only during eval
ARTIFICER_EXEC_DIR=<eval-scoped-exec-dir>
RUNTIME_EVAL_MODE=true                        # no identity writes or git ops
RUNTIME_CONCURRENCY=1
RUNTIME_RESUME_ON_STARTUP=false
# + preset / model overrides from CLI flags
```

This is the critical difference from today's bench: **identity dir is the agent project** (loaded read-only), not `packages/runtime`.

### Eval mode (`RUNTIME_EVAL_MODE`)

When `RUNTIME_EVAL_MODE=true`, the runtime treats the identity repo as **read-only** for the lifetime of the process:

| Subsystem | Normal behavior | Eval mode |
|-----------|-----------------|-----------|
| Workstream memory distill → identity | Writes `identity/memories/*.md` | **Skipped** |
| `learn` / memory teaching tools | May append to identity | **Rejected or no-op** with clear error |
| Identity git pull (periodic / startup) | Pulls from `IDENTITY_REPO` | **Disabled** |
| Identity auto-commit / auto-push | After runs, per config | **Disabled** |
| `edit_file` / `write_file` under identity dir | Allowed for self-modification | **Blocked** |
| Reading identity (instructions, roles, tools, memories) | Yes | Yes — this is what we're testing |
| Workstream workspace edits | Yes | Yes — task work happens here |

Implementation: gate in `Engine` and `IdentityGitSync` (and any identity-writing tools) on `config.evalMode` loaded from `RUNTIME_EVAL_MODE`. The eval driver always sets this flag; there is no `--allow-identity-writes` escape hatch in v1.

Graded tasks must not assert on new identity files. Use workspace assertions (`plan.md`, patches, outbound messages) instead.

---

## Results storage

```
$ARTIFICER_EXEC_DIR/evals/
├── latest -> runs/2026-08-11T14-32-01Z-smoke
└── runs/
    └── 2026-08-11T14-32-01Z-smoke/
        ├── attempts.json
        ├── eval-report.json
        ├── report.json
        ├── run-config.json          # includes identity git sha, preset, models
        ├── predictions.jsonl        # patch kinds only
        ├── instances.json
        ├── history/<timestamp>.json # optional archive for trend chart
        └── runs/<task-id>.json      # trajectories
```

**UI reader changes** (`packages/runtime/src/server/bench.ts`, `packages/ui`):

- Default results dir: `$ARTIFICER_EXEC_DIR/evals/latest/` (fallback: still support `BENCH_RESULTS_DIR` and legacy `bench/results/` for monorepo dev).
- Suite catalog: read `agent/evals/suites/*.json` + `agent/evals/tasks/*/eval.json` from identity dir.
- **Benchmark nav always visible.** When `/api/bench/runs` returns 404, show an empty state with `artificer eval run` instructions and suite list from `/api/bench/suites` (or static Pack A copy if no `agent/evals/` yet). Replace maintainer-only `packages/runtime` copy in `BenchPage.tsx`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Identity repo (git)                                         │
│  agent/evals/suites/*.json  +  agent/evals/tasks/<id>/      │
└───────────────────────────┬─────────────────────────────────┘
                            │ artificer eval run
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Eval driver (@artificer-ai/eval, invoked by CLI)            │
│  load suite → spawn one runtime (eval mode, identity RO)   │
│  for each task:                                             │
│    deliver prompt (message or workstream)                   │
│    poll /events + /state                                    │
│    extract patch / capture outbound messages                │
│    run grader (hidden/)                                     │
│    write attempts.json + trajectories                       │
│  stop runtime                                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ ARTIFICER_EXEC_DIR/evals/runs/<run-id>/                     │
└───────────────────────────┬─────────────────────────────────┘
                            │ GET /api/bench/*
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Runtime UI — Benchmark page (read-only)                     │
└─────────────────────────────────────────────────────────────┘
```

**Monorepo bench (`pnpm bench`)** remains for engine regression (SWE-bench, DeepSWE, greenfield hard tier). It may internally call the same eval driver with `ARTIFICER_IDENTITY_DIR` unset (bare runtime) for backward compatibility.

---

## Example eval packs (Artificer repo as source material)

Ship as `agent/evals/` templates in `artificer init` and as reference fixtures in the monorepo at `evals/examples/` (documentation + copy source; not wired to maintainer `pnpm bench`).

### Pack A: `smoke` (3 tasks, ~10–15 min)

| Task id | Kind | What it tests | Artificer source |
|---------|------|---------------|------------------|
| `status-preset-query` | `message` | Agent answers "What model preset am I on?" using live config | `artificer.config.json`, Models page data |
| `implement-hello-tool` | `greenfield` | Implement a minimal `defineTool` in fixture scaffold | Pattern from `agent/tools/` docs |
| `fix-format-cost-display` | `repo-patch` | Fix a pinned bug in `formatCost()` (fixture branch with intentional regression) | `packages/ui/src/format.ts` |

### Pack B: `runtime-dev` (5 tasks, maintainer-oriented)

| Task id | Kind | What it tests | Artificer source |
|---------|------|---------------|------------------|
| `workstream-status-api` | `repo-patch` | Add/fix a field on `/api/state` response | `packages/runtime/src/server/app.ts` |
| `quota-window-pause` | `repo-patch` | Fix failing test in quota ledger pause logic | `packages/runtime/src/engine/quota-*.test.ts` |
| `role-override-loaded` | `message` | With `agent/roles/worker.md` customized, worker run reflects override | Role customization spec |
| `bench-report-regression` | `repo-patch` | Fix off-by-one in resolve rate calculation | `packages/runtime/bench/src/report.ts` |
| `memory-recall-query` | `message` | With a pre-seeded memory in identity, agent recalls it in reply (`message-contains`) | Workstream memory design — read-only; no distill during eval |

### Pack C: `orchestration` (identity-behavior focused)

| Task id | Kind | What it tests |
|---------|------|---------------|
| `no-learn-on-repo-task` | `workstream` | Repo task completes with `learnCallCount === 0` (communicator uses `start_workstream`) |
| `planner-writes-plan` | `workstream` | `plan.md` exists in workspace before worker edits |
| `reviewer-blocks-bad-patch` | `workstream` | Intentionally broken fixture; expect reviewer notes + retry (workstream-status + file assertions) |

### Fixture pinning strategy for `repo-patch` tasks

Public repos (including `artificer-ai/artificer`) are pinned to a **specific commit** in `eval.json`. Optional `fixture/` contains:

- `introduce-bug.patch` — applied by the driver before the agent runs (eval maintains a known failing state without polluting main).
- Or a **fixture branch** on a fork (`eval/fix-format-cost-display`) referenced by `baseCommit`.

Hidden graders run `pnpm test` / `tsc` only on the patched tree. The agent never sees `hidden/`.

---

## `artificer init` changes

Scaffold default eval pack (Pack A smoke) into new projects:

```
agent/evals/suites/smoke.json
agent/evals/tasks/status-preset-query/...
agent/evals/tasks/implement-hello-tool/...
agent/evals/tasks/fix-format-cost-display/...
```

`implement-hello-tool` uses a self-contained greenfield fixture (not the full Artificer monorepo) so `artificer init` works offline. `fix-format-cost-display` in the template points at a **small bundled fixture repo** (vendored snapshot under `agent/evals/tasks/.../fixture/`) rather than cloning Artificer itself — keeps init fast. Monorepo `evals/examples/` can use full repo pins for dogfooding.

---

## Regression compare

`artificer eval compare` produces:

```json
{
  "baselineRunId": "2026-08-11T09-00-00Z-smoke",
  "candidateRunId": "2026-08-11T14-32-01Z-smoke",
  "summary": {
    "resolvedDelta": +1,
    "costPerSolvedDeltaUsd": -0.04,
    "regressions": ["quota-window-pause"],
    "improvements": ["fix-format-cost-display"]
  }
}
```

UI: optional comparison overlay on Benchmark page (v1.1); CLI table output in v1.

Record in `run-config.json`:

```json
{
  "identityGitSha": "abc123",
  "identityBranch": "main",
  "presetId": "async-economy",
  "models": { "low": "...", "medium": "...", "high": "..." }
}
```

---

## Phased delivery

### Phase 1 — Foundation (MVP)

- [ ] Create `packages/eval` (`@artificer-ai/eval`); migrate bench driver
- [ ] `agent/evals/` convention documented
- [ ] `RUNTIME_EVAL_MODE` in runtime (identity read-only guards)
- [ ] `@artificer-ai/cli` depends on `@artificer-ai/eval`; `artificer eval run` + `artificer eval list`
- [ ] Task kinds: `message`, `workstream`, `greenfield`
- [ ] Graders: `shell`, `workstream-status`, `message-contains`
- [ ] Results to `$ARTIFICER_EXEC_DIR/evals/`
- [ ] UI reads new results path; Benchmark nav always visible with consumer-facing empty state
- [ ] `artificer init` scaffolds Pack A (bundled fixtures)

### Phase 2 — Repo-patch + compare

- [ ] `repo-patch` kind with pin + optional `introduce-bug.patch`
- [ ] `artificer eval compare`
- [ ] `file-exists` grader (workspace paths only, e.g. `plan.md`)
- [ ] Monorepo `evals/examples/` Pack B for dogfooding

### Phase 3 — Power user packs (optional)

- [ ] Downloadable SWE-bench Lite curated suite (`artificer eval run --pack swebench-lite-30`)
- [ ] CI recipe (GitHub Action) for eval on PRs touching `agent/`
- [ ] LLM-as-judge grader behind explicit opt-in

---

## Resolved decisions

| # | Decision |
|---|----------|
| 1 | **`@artificer-ai/eval`** — separate published package for testability. CLI depends on it like `@artificer-ai/runtime`. Monorepo `pnpm bench` dev-depends on it. |
| 2 | **One runtime per suite** — single spawn for the full suite; fresh workstream + workspace per task. |
| 3 | **`RUNTIME_EVAL_MODE=true`** — disables all identity mutation (memory writes, learn, identity git pull/push/commit, edits under identity tree). No opt-out in v1. |
| 4 | **Benchmark nav empty state** — nav item always visible; page shows onboarding when no results exist. |

## Remaining open question

**Bundled vs live Artificer repo fixtures** — `artificer init` uses vendored mini-fixtures; monorepo `evals/examples/` pins real SHAs. Document an update process when fixtures drift (likely: maintainer script to refresh vendored snapshots from pinned commits).

---

## Success criteria

1. A user who ran `artificer init` can execute `artificer eval run` and see results in the Benchmark UI without cloning the Artificer monorepo.
2. Changing `agent/instructions.md` and re-running produces a diffable compare report.
3. Example Pack A passes on a reference identity with `quality-first` preset (document expected pass rate band).
4. Monorepo maintainers can dogfood Pack B from `evals/examples/` against a dev identity without using `packages/runtime/bench/results/`.

---

## References

- Eval package (to be created): `packages/eval/`
- Existing bench harness (migration source): `packages/runtime/bench/`
- UI Benchmark page: `packages/ui/src/pages/BenchPage.tsx`
- Results reader: `packages/runtime/src/server/bench.ts`
- Greenfield task template: `packages/runtime/bench/tasks/greenfield/greenfield-todo-store/`
- Identity layout: `docs/guides/agent-identity-setup.md`
