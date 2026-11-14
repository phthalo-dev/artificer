---
title: Agent Evals
description: Agent evals measure **your configured agent** — instructions, roles, tools, memories, and model preset — on **tasks you own**.
---

# Agent Evals

Agent evals measure **your configured agent** — instructions, roles, tools, memories, and model preset — on **tasks you own**. They answer: *did this identity change make my agent better or cheaper on the work I actually care about?*

Run evals from your agent project with `artificer eval`. Results land in your execution directory and appear in the **Benchmark** page of the runtime UI. No Artificer monorepo required.

If you have not scaffolded an agent yet, start with [Setting Up an Agent Identity Repo](/docs/guides/agent-identity-setup).

---

## Quick start

From your agent project root (where `artificer.config.json` lives):

```bash
# Run the default smoke suite
artificer eval run

# Run a named suite
artificer eval run --suite smoke

# Run one task
artificer eval run --task status-preset-query

# Pin a model preset for reproducibility (overrides .env for this run only)
artificer eval run --preset quality-first

# List available suites, tasks, and downloadable packs
artificer eval list

# Run the curated SWE-bench Lite pack (30 tasks; identity-aware)
artificer eval run --pack swebench-lite-30

# Smoke the pack with a single instance
artificer eval run --pack swebench-lite-30 --limit 1
```

Start the agent UI (`artificer dev` or `artificer start`), open **Benchmark** in the sidebar, and review pass/fail, cost, and per-task trajectories.

---

## `agent/evals/` layout

Eval definitions live in your identity repo under `agent/evals/` and are version-controlled with the rest of the agent:

```
my-agent/
├── artificer.config.json
├── agent/
│   ├── instructions.md
│   ├── tools/
│   └── evals/
│       ├── suites/
│       │   └── smoke.json              # suite manifest (lists task ids)
│       └── tasks/
│           └── <task-id>/
│               ├── eval.json           # task manifest (kind, grader, limits)
│               ├── prompt.md           # inbound message or workstream goal
│               ├── fixture/            # optional scaffold (greenfield, repo context)
│               └── hidden/             # graders only — never sent to the agent
└── .env
```

`artificer init` scaffolds a starter **smoke** suite with three tasks:

| Task id | Kind | What it tests |
|---------|------|---------------|
| `status-preset-query` | `message` | Agent answers a preset question using live config |
| `fix-format-cost-display` | `repo-patch` | Agent fixes a vendored `formatCost` regression |
| `implement-hello-tool` | `greenfield` | Agent implements a tool in a bundled fixture |

### Suite file (`suites/smoke.json`)

```json
{
  "name": "Smoke",
  "description": "Fast regression checks for a scaffolded agent.",
  "taskIds": [
    "status-preset-query",
    "fix-format-cost-display",
    "implement-hello-tool"
  ]
}
```

Suite files are named `<id>.json`. Pass the id (without `.json`) to `--suite`.

### Task manifest (`tasks/<task-id>/eval.json`)

```json
{
  "id": "status-preset-query",
  "title": "Status preset query",
  "kind": "message",
  "grade": { "type": "message-contains", "pattern": "quality-first" }
}
```

Optional fields:

| Field | Purpose |
|-------|---------|
| `timeoutMs` | Per-task timeout (default 5 minutes) |
| `maxRuns` | Cap LLM calls per workstream (workstream/greenfield/repo-patch) |
| `test_command` | Metadata for greenfield tasks (mirrors the shell grader command) |

### Prompt (`prompt.md`)

The text the agent receives:

- **`message`** — sent as an inbound chat message (communicator path)
- **`workstream`** / **`greenfield`** / **`repo-patch`** — used as the workstream goal

### Fixture and hidden directories

- **`fixture/`** — optional scaffold the agent works in. For **greenfield** and fixture-based **repo-patch** tasks, this becomes a git repo the agent clones into its workspace.
- **`hidden/`** — grading assets only. Files are **never** shown to the agent. For greenfield / repo-patch tasks, hidden tests are overlaid onto the agent's patch at grade time (same hide-until-grade principle as SWE-bench).

For greenfield hidden tests, paths in `hidden/` map to the repo root. Example: `hidden/tests/foo.test.js` lands at `tests/foo.test.js` in the graded tree.

---

## Task kinds

| Kind | What the agent does | Typical grader |
|------|---------------------|----------------|
| `message` | Receives `prompt.md` as a chat message | `message-contains` |
| `workstream` | Starts a workstream with `prompt.md` as the goal | `workstream-status` |
| `greenfield` | Builds from a `fixture/` scaffold via workstream | `shell` (runs hidden tests) |
| `repo-patch` | Fixes a pinned repo (remote SHA or vendored `fixture/`) | `shell` (runs hidden tests) |

**`message`** evals are fast and identity-specific — no repo clone. Use them for routing, tone, config questions, and memory recall.

**`workstream`** evals exercise orchestration. The v1 grader checks that the workstream reached an expected terminal status (e.g. `done`).

**`greenfield`** evals measure build-from-scratch capability. The driver materializes `fixture/` as a git repo, the agent implements against `prompt.md`, and the grader applies the extracted patch plus hidden tests.

**`repo-patch`** evals pin a repo + commit (`repo.url` / `repo.baseCommit`). Use `url: "fixture"` with a vendored snapshot under `fixture/` for offline Pack A tasks; otherwise clone a remote at the pinned SHA. Optional `fixture/introduce-bug.patch` is applied before the agent runs. See `evals/examples/README.md` for refreshing that patch.

---

## Graders

All graders run **after** the agent finishes, on the machine running `artificer eval` — not inside the agent.

| `grade.type` | Pass condition | Used by |
|--------------|----------------|---------|
| `message-contains` | At least one outbound message contains `pattern` (substring match) | `message` |
| `workstream-status` | Final workstream status is in `expect` (e.g. `["done"]`) | `workstream` |
| `shell` | `command` exits 0 in a sandboxed workdir (patched fixture + hidden overlay) | `greenfield`, `repo-patch` |
| `file-exists` | Path exists relative to the **workspace** (agent workdir / cloned repo), not the identity dir | `workstream`, `greenfield`, `repo-patch` |
| `swebench` | Official SWE-bench harness over `predictions.jsonl` (Docker + `swebench` Python package). Without them, patches are recorded and tasks stay ungraded. | `--pack swebench-lite-30` |
| `llm-judge` | An LLM grades material against `rubric`. **Opt-in:** `--llm-judge` or `ARTIFICER_EVAL_LLM_JUDGE=true`. | any kind |

### Examples

**Message — preset recall:**

```json
{
  "kind": "message",
  "grade": { "type": "message-contains", "pattern": "quality-first" }
}
```

**Workstream — expect completion:**

```json
{
  "kind": "workstream",
  "grade": { "type": "workstream-status", "expect": ["done"] }
}
```

**Greenfield — hidden tests:**

```json
{
  "kind": "greenfield",
  "test_command": "node --test tests/*.test.js",
  "grade": {
    "type": "shell",
    "command": "node --test tests/*.test.js"
  }
}
```

Greenfield shell graders clone the fixture, apply the agent's patch, overlay `hidden/`, and run the command. The grader requires at least one test to execute (Node's `node --test` reports `ℹ tests N`).

**Workspace file check:**

```json
{
  "kind": "workstream",
  "grade": { "type": "file-exists", "path": "plan.md" }
}
```

`file-exists` looks under the workstream workspace (cloned repo when present). It never checks the identity directory — eval mode forbids identity writes.

Graders must not assert on new identity files. Eval mode blocks identity writes — use workspace outputs, outbound messages, or hidden tests instead.

---

## CLI reference

```bash
artificer eval run [--suite <id>] [--task <id>] [--preset <id>]
artificer eval list
artificer eval compare [baseline] [candidate] [--write]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--suite` | `smoke` | Run all tasks listed in `agent/evals/suites/<id>.json` |
| `--task` | — | Run a single task by id (ignores `--suite`) |
| `--preset` | from `.env` / config | Pin a model preset for this run only |

`artificer eval compare` diffs two run directories (resolved count, cost/solved, regressions, improvements). Omit both args to compare the latest two runs under `$ARTIFICER_EXEC_DIR/evals/runs`. Pass `--write` to save `compare.json` next to the candidate run.

The eval driver:

1. Loads the suite (or single task) from `agent/evals/`
2. Spawns **one runtime** with your identity dir and `RUNTIME_EVAL_MODE=true`
3. Runs each task sequentially (fresh workstream per task)
4. Grades results and writes artifacts to your exec dir
5. Stops the runtime when the suite finishes

On completion, the CLI prints the results directory:

```
Results: /Users/you/.artificer/my-agent/eval-runs/evals/runs/2026-08-11T14-32-01Z-smoke
```

---

## Results and the Benchmark UI

Eval artifacts live in your **execution directory**, not in the identity repo — eval outputs never dirty your agent's git history.

```
$ARTIFICER_EXEC_DIR/evals/
├── latest -> runs/2026-08-11T14-32-01Z-smoke
└── runs/
    └── 2026-08-11T14-32-01Z-smoke/
        ├── attempts.json          # per-task outcome, duration, tokens, USD
        ├── eval-report.json       # resolved / unresolved ids
        ├── run-config.json        # identity sha, preset, suite metadata
        ├── instances.json         # task manifests that ran
        └── runs/<task-id>.json    # per-task trajectory
```

Default exec dir (when `ARTIFICER_EXEC_DIR` is unset):

```
~/.artificer/<project-name>/eval-runs/
```

Set `ARTIFICER_EXEC_DIR` in `.env` to override (same variable as `artificer dev`).

### Viewing in the UI

1. Start the agent: `artificer dev`
2. Open the web UI (default `http://localhost:4100`)
3. Click **Benchmark** in the sidebar

The Benchmark page reads `$ARTIFICER_EXEC_DIR/evals/latest/`. When no results exist yet, it shows onboarding with `artificer eval run` commands and lists suites from your `agent/evals/` directory.

Each task row links to a detail page with the call tree, token usage, and cost breakdown — the same shapes the maintainer bench harness uses, but scoped to your identity's tasks.

---

## `RUNTIME_EVAL_MODE` (read-only identity)

Every identity eval run sets `RUNTIME_EVAL_MODE=true` on the spawned runtime. The identity repo is **read-only** for the lifetime of the eval process:

| Subsystem | Normal behavior | Eval mode |
|-----------|-----------------|-----------|
| Memory distill → identity | Writes `identity/memories/*.md` | Skipped |
| `learn` / `add_memory` tools | May append to identity | Rejected with clear error |
| Identity git pull / auto-commit / auto-push | Per config | Disabled |
| `edit_file` / `write_file` under identity dir | Allowed for self-modification | Blocked |
| Reading identity (instructions, roles, tools, memories) | Yes | Yes — this is what you're testing |
| Workstream workspace edits | Yes | Yes — task work happens here |

There is no opt-out flag in v1. Evals must not change your agent's identity — only read it and exercise it.

Because identity writes are blocked, graders should inspect workspace outputs (patches, files, outbound messages) rather than expecting new memory files.

---

## Maintainer bench vs consumer evals

Artificer ships two related but distinct benchmarking paths:

| | **Consumer evals** (`artificer eval`) | **Maintainer bench** (`pnpm bench`) |
|---|--------------------------------------|--------------------------------------|
| **Who** | Agent owners testing their identity | Artificer engine developers |
| **Where tasks live** | `agent/evals/` in your identity repo | `packages/runtime/bench/tasks/` in the monorepo |
| **Identity loaded** | Your agent project (`ARTIFICER_IDENTITY_DIR`) | Bare runtime defaults (no customer identity) |
| **Task suites** | Custom smoke/nightly suites you define | SWE-bench Lite, DeepSWE, greenfield hard tier |
| **Results location** | `$ARTIFICER_EXEC_DIR/evals/` | `packages/runtime/bench/results/` |
| **Requires monorepo** | No | Yes (clone Artificer repo) |
| **Purpose** | Regression-test *your* agent on *your* tasks | Regression-test the *engine* on public benchmarks |

Use **`artificer eval`** for the day-to-day loop:

```
edit identity → artificer eval run → review Benchmark UI → commit or revert
```

Use **`pnpm bench`** only if you are developing Artificer itself and need SWE-bench/DeepSWE correctness signals. The harness implementation lives in `@artificer-ai/eval` (`packages/eval/src/bench/`); task fixtures and results stay under `packages/runtime/bench/`. See [Runtime benchmarking harness](https://github.com/phthalo-dev/artificer/blob/main/packages/runtime/bench/README.md) for maintainer usage.

### Maintainer Pack B

For dogfooding identity evals against Artificer itself, copy Pack B from the monorepo (not published to npm):

```bash
cp -R evals/examples/runtime-dev/* path/to/identity/agent/evals/
artificer eval run --suite smoke
```

Tasks are small offline fixtures (`repo.url: "fixture"`), not a full monorepo pin. See [`evals/examples/README.md`](https://github.com/phthalo-dev/artificer/blob/main/evals/examples/README.md) for task list, identity seeding for message tasks, and how to refresh `introduce-bug.patch`.

The underlying driver lives in `@artificer-ai/eval` — both paths share HTTP polling, cost collection, and report shapes. Consumer evals add identity loading and eval-mode guards; maintainer bench adds Docker-based SWE-bench grading and external-agent comparison.

---

## Adding a new task

1. Create `agent/evals/tasks/<task-id>/` with `eval.json` and `prompt.md`
2. Add optional `fixture/` and `hidden/` as needed
3. Add the task id to a suite's `taskIds` array in `agent/evals/suites/<suite>.json`
4. Run `artificer eval run --task <task-id>` to iterate, then `artificer eval run --suite <suite>` for the full suite

Verify with `artificer eval list` — tasks appear when their directory contains an `eval.json`.

---

## Tips

- **Pin presets** when comparing runs: `artificer eval run --preset quality-first`
- **Keep smoke suites fast** — a few message + workstream tasks that finish in minutes, not hours
- **Use greenfield for capability checks** — hidden tests ensure the agent actually implemented the spec
- **Commit eval tasks with identity changes** — when you change instructions or tools, your eval suite travels with the diff
- **Check `run-config.json`** — records the identity git SHA and preset used, so you can correlate results with commits

---

## Downloadable packs

Packs are named suites shipped with `@artificer-ai/eval`. They do **not** write into your identity repo.

```bash
artificer eval run --pack swebench-lite-30
artificer eval run --pack swebench-lite-30 --limit 1
```

`swebench-lite-30` is the curated 30-instance SWE-bench Lite subset (all 12 repos, includes the mini-suite's 6 tasks). Each instance is a `repo-patch` task against the pinned GitHub SHA. After the agent finishes, the driver writes `predictions.jsonl`. If Docker and the `swebench` Python package are available, it runs the official harness (same script as maintainer bench) and fills `eval-report.json`. Otherwise patches are kept and tasks stay ungraded.

Maintainer equivalent: `pnpm bench --suite tasks/swebench-lite-curated-30.json` from `packages/runtime`.

## LLM-as-judge (opt-in)

`grade.type: "llm-judge"` with a `rubric` string asks a model to emit `PASS` or `FAIL`. It never runs unless you pass `--llm-judge` or set `ARTIFICER_EVAL_LLM_JUDGE=true`. Uses `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` (same as the runtime).

```json
{
  "kind": "message",
  "grade": {
    "type": "llm-judge",
    "rubric": "The reply must name the configured model preset."
  }
}
```

## CI on identity PRs

Copy [`evals/examples/github-eval.yml`](https://github.com/phthalo-dev/artificer/blob/main/evals/examples/github-eval.yml) to `.github/workflows/eval.yml` in the agent repo. It runs the smoke suite when `agent/` or `artificer.config.json` change. Store `LLM_API_KEY` as a GitHub Actions secret.

---

## Related guides

- [Setting Up an Agent Identity Repo](/docs/guides/agent-identity-setup) — scaffold and configure your agent
- [Managing Memories](/docs/guides/managing-memories) — how memories work (read-only during evals)
- [Runtime benchmarking harness](https://github.com/phthalo-dev/artificer/blob/main/packages/runtime/bench/README.md) — maintainer SWE-bench / DeepSWE bench (monorepo only)
