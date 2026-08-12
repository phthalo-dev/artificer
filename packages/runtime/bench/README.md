# Runtime benchmarking harness (SWE-bench-style)

> **Consumers:** for identity-based agent evals (`agent/evals/`, `artificer eval run`),
> see [Agent evals](../../../docs/guides/agent-evals.md). This README covers the
> **maintainer** SWE-bench / DeepSWE harness that lives under `packages/runtime/bench/`.

Drives the `@artificer-ai/runtime` agent over HTTP against a curated suite of real
repo-fixing tasks, then measures **correctness** (does the agent's patch make
the failing tests pass) and **cost/efficiency** (tokens, USD, LLM call count)
per task.

The task schema and prediction format are SWE-bench-compatible, so the same
harness scales from the mini-suite to full SWE-bench Lite by changing the
instance list.

## How it works

```
mini-suite.json ──▶ driver (tsx) ──spawn──▶ isolated runtime (temp data dir)
                       │  POST /messages (repo + base_commit + problem)
                       │  poll GET /state until workstream is done/failed/timeout
                       │  git diff vs base_commit  ─▶ predictions.jsonl
                       │  GET /messages/:id/cost    ─▶ attempts.json (tokens/USD/runs)
                       ▼
              predictions.jsonl ──▶ swebench harness (Docker) ──▶ eval-report.json
                                                                       │
                       attempts.json + eval-report.json ──▶ report.md / report.json
```

Each instance runs against its own freshly-spawned runtime with an isolated
temp `ARTIFICER_DATA_DIR`, `RUNTIME_CONCURRENCY=1`, resume disabled, and pinned
tier models — so runs are isolated and as reproducible as an LLM allows.

## Prerequisites

- **ripgrep (`rg`)** on PATH for grep/glob search tools (`brew install ripgrep`
  on macOS, `apt install ripgrep` on Debian/Ubuntu).
- The runtime's LLM credentials configured (e.g. `LLM_API_KEY` in
  `packages/runtime/.env`). The harness inherits the runtime's environment.
- For the agent to clone target repos: network access. A `GITHUB_TOKEN` in the
  runtime env avoids public-clone rate limits but is not required.
- For grading only: Docker running, plus Python 3.11+ with the `swebench`
  package installed (see `eval/requirements.txt`).

## Usage

From `packages/runtime`:

```bash
# SWE-bench Lite mini (async-economy preset, default)
pnpm bench:swebench
pnpm bench:swebench:eval
pnpm bench:swebench:report
# or one shot:
pnpm bench:full:swebench

# DeepSWE mini (async-economy preset)
pnpm bench:deepswe
pnpm bench:full:deepswe

# DeepSWE TypeScript mini (quality-first for debugging)
pnpm bench:deepswe:typescript:quality-first
# Results: bench/results/quality-first/deepswe-typescript-mini/

# Compare presets on SWE-bench mini
pnpm bench:swebench:quality-first
pnpm bench:swebench:ultra-budget
pnpm bench:swebench:async-slow
pnpm bench:swebench:bench-budget

# OpenCode Go presets (set LLM_BASE_URL=https://opencode.ai/zen/go/v1 first)
pnpm bench:swebench:go-economy    # recommended: flash routing + kimi workers
pnpm bench:swebench:go-flash      # cheapest iteration
pnpm bench:swebench:go-quality    # strongest open models, still async role map
pnpm bench:deepswe:typescript:go-economy  # fast TS subset for quick probes
```

Results land under `bench/results/<preset>/<suite>/` (e.g.
`bench/results/async-economy/mini-suite/`).

Model presets match the runtime (`MODEL_PRESET` / Models page in the UI):
`async-economy` (default), `ultra-budget`, `async-slow`, `quality-first`, `bench-budget`,
`open-weights-economy`, `baseten-open-weights`,
`go-economy`, `go-flash`, `go-mimo`, `go-quality`, `go-minimax`.

Go presets require `LLM_BASE_URL=https://opencode.ai/zen/go/v1` and an [OpenCode Go](https://opencode.ai/docs/go)
subscription key. Start with `go-economy` for the best async correctness-per-dollar tradeoff.

## Open-weights presets

```bash
# Zen open-weights (requires LLM_BASE_URL=https://opencode.ai/zen/v1)
MODEL_PRESET=open-weights-economy pnpm bench:deepswe

# Baseten (requires BASETEN_API_KEY + LLM_BASE_URL=https://inference.baseten.co/v1)
MODEL_PRESET=baseten-open-weights LLM_BASE_URL=https://inference.baseten.co/v1 \
  LLM_API_KEY=$BASETEN_API_KEY pnpm bench:deepswe
```

```bash
# Generic runner with flags
pnpm bench:run --suite tasks/deepswe-mini-suite.json --preset ultra-budget --limit 1
```

### Useful flags (step 1)

```bash
pnpm bench --instance-ids astropy__astropy-12907,sympy__sympy-24152
pnpm bench --limit 2                 # only the first N instances
pnpm bench --timeout-ms 1800000      # per-instance budget (default 20m)
pnpm bench --max-runs 50             # cap LLM calls per workstream
pnpm bench --model claude-sonnet-4-6 --model-high claude-opus-4-8
pnpm bench --keep-data               # keep each instance's temp data dir
pnpm bench --port 4111               # runtime port to spawn on
pnpm bench --quiet                   # suppress live progress (start/end only)
pnpm bench --quiet-tools             # live progress without per-tool lines
pnpm bench --preflight-clone         # clone repo before agent runs (Harbor-style)
```

`BENCH_PREFLIGHT_CLONE=true` (or `--preflight-clone`) clones the target repo into
the workstream workspace immediately after it is created, then sends a shortened
task message. Use this to measure coding-only ceiling separately from clone
orchestration. Full clone path remains the default for regression testing.

Each attempt in `attempts.json` records setup observability fields:
`learnCallCount`, `localRepoReady`, `cloneLocation`, `setupPhaseMs`, and
`firstEditMs`. The driver warns when `learnCallCount > 0` on a repo task.

All flags also have env equivalents (`BENCH_*`, `LLM_MODEL*`); see
`src/config.ts`.

Context borrowing env vars (see `packages/runtime/.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUNTIME_TOOL_RESULT_MAX_CHARS` | 12000 | Spill threshold per tool invocation |
| `RUNTIME_TOOL_RESULT_MAX_PER_RUN_CHARS` | 80000 | Aggregate tool-result budget per run |
| `RUNTIME_MICROCOMPACT_ENABLED` | true | Compact prior-run tool outputs in context |
| `RUNTIME_FILE_CACHE_MAX_ENTRIES` | 64 | Recently-read file hints per workstream |
| `RUNTIME_REQUIRE_RG` | true | Require ripgrep for grep/glob tools |

### Live progress

While an instance runs, the driver tails the runtime's `/events` SSE stream and
prints timestamped lines so you can watch work happen instead of waiting for the
per-instance summary:

```
[bench] (1/1) pytest-dev__pytest-5221 — pytest-dev/pytest
   [00:03] workstream -> planning
   [00:05] ▶ planner
   [00:07]     · planner: run_shell (git clone https://github.com/pytest-dev/pytest.git)
   [01:12] ✓ planner
   [01:14] workstream -> reviewing
   [01:16] ▶ reviewer
   ...
[bench]   -> submitted | 612s | patch 1843B | $0.74 | 9 runs
```

Use `--quiet` to turn this off, or `--quiet-tools` to keep the role/workstream
lines but drop the noisier per-tool-call lines.

## The suite

Two curated suites ship under `tasks/`:

| File | Kind | Eval command |
| --- | --- | --- |
| `mini-suite.json` | SWE-bench Lite (6 instances) | `pnpm bench:eval` |
| `deepswe-mini-suite.json` | [DeepSWE](https://deepswe.datacurve.ai/) Harbor tasks (6 instances) | `pnpm bench:eval:deepswe` |
| `deepswe-typescript-mini.json` | DeepSWE TS/JS subset (4 instances) for local debugging | `pnpm bench:eval:deepswe` |
| `greenfield-mini.json` | Greenfield build tasks (6 instances), graded Docker-free against hidden acceptance tests | `pnpm bench:eval:greenfield` |
| `greenfield-hard.json` | Larger, multi-file greenfield tasks (5 instances) — see "Greenfield difficulty tiers" below | `pnpm bench:eval:greenfield` (with `BENCH_RESULTS_DIR` set to the hard-tier results dir) |

Run a specific suite:

```bash
pnpm bench --suite tasks/mini-suite.json
pnpm bench --suite tasks/deepswe-mini-suite.json
```

SWE-bench instance data is pulled from the HuggingFace datasets-server and cached under `tasks/.cache/`. DeepSWE tasks (Harbor format: `task.toml` + `instruction.md`) are fetched from [datacurve-ai/deep-swe](https://github.com/datacurve-ai/deep-swe) and cached under `tasks/.cache/deepswe/`.

Edit the `instanceIds` array in a suite file to curate a different subset.

## Greenfield build tasks

Unlike the SWE-bench and DeepSWE suites (fix a bug in an existing repo), greenfield
tasks measure sustained *build-from-scratch* work: the agent gets a stub scaffold
and a spec, and must implement multiple files across however many plan/implement/
review cycles it takes. Grading tests are never shown to the agent — they're
overlaid onto its patch only at eval time, the same hide-until-grading approach
SWE-bench uses for its official test patch.

Add a new task by creating `bench/tasks/greenfield/<task-id>/` with:

```
<task-id>/
├── meta.json      # { task_id, display_title, test_command }
├── spec.md        # the goal text the agent receives
├── scaffold/      # stub files (plain ESM JS, no deps) the agent implements — this becomes the cloned repo
└── hidden/        # overlaid onto the agent's patch only at grading time; never sent to the agent
```

Fixtures are plain ESM JavaScript with no npm dependencies (graded via `node --test`)
so eval never needs `npm install` or Docker. Add the new task id to a suite file's
`instanceIds` (or create a new suite file) to include it in a run.

`hidden/` is overlaid onto the patched repo at its **root**, not under a `hidden/`
subdirectory — so hidden test files must themselves include their full intended
path relative to the repo root. For example, `hidden/tests/foo.test.js` in the
fixture lands at `tests/foo.test.js` in the graded repo. `meta.json`'s
`test_command` glob must actually match those hidden test file names (and the
grader now requires the test run report at least one executed test — see
`eval-greenfield.ts`'s `gradeOne`), or the fixture will silently grade every
prediction as `error`/failed-to-verify rather than a meaningful resolved/unresolved
result.

### Greenfield difficulty tiers

`greenfield-mini.json`'s six fixtures (todo store, job queue, CSV/table, LRU/TTL
cache, rate limiter, text template) are each 2-3 files, independently
implementable, and every frontier agent tested so far (Artificer, Claude Code,
opencode, Cursor) solved all six in a single LLM turn each. That's a sign the
*mini* tier is too easy/too textbook-familiar to be a meaningful difficulty
signal at frontier-model level — solving an LRU cache in one shot doesn't
exercise "sustained build-from-scratch work," it's pattern recall.

`greenfield-hard.json` targets that gap with *scope* first: 3 fixtures (router,
task-cli, query-engine), 5-6 files each, with real cross-file contracts an
agent has to get right end-to-end (e.g. `greenfield-http-router`'s hidden
tests exercise `App#handle()`, which only produces correct responses if the
router's param matching, the middleware chain's short-circuit/error-
propagation semantics, and the request/response parsing all compose
correctly — no single file's unit-level correctness is sufficient).

First real run (3 fixtures): Artificer's own orchestration missed one (2/3, a
genuine 19/20-hidden-tests bug in the POST+middleware integration path) — but
Claude Code, opencode, and Cursor all still one-shot all 3, same as the mini
tier. Scope/file-count alone wasn't enough to stop a frontier CLI agent's
*internal* iteration (a single headless invocation can still read/write/test
many files across many of its own tool calls before exiting — "one LLM call"
in our usage accounting is not "one forward pass"). `greenfield-vm` tried a
different lever instead of just more files: a stack-based VM (tokenizer →
parser → interpreter, 4 files, ~250 reference LOC) with genuine algorithmic
depth — many interacting opcodes, jump/label resolution, non-commutative-
operand ordering, truncating division, a dozen-plus distinct error
conditions. Result: still 3/4 and 4/4/4/4 across all four agents — moderate
algorithmic depth at ~250 LOC didn't move the needle either.

`greenfield-lang` is the next attempt: an order-of-magnitude scale-up, not
just a different flavor — a tree-walking interpreter for a small language
(lexer → recursive-descent parser → scope-chain environment → evaluator),
13 files, ~620 reference LOC, with real lexical scoping (closures capture
their *defining* environment, not the caller's — the single most common bug
in a hand-written interpreter), short-circuit evaluation, and a deliberately
non-JS truthiness rule (`0`/`""` are truthy) that a careless implementation
gets wrong by reflex. Same four-file-per-fixture template and Docker-free
`node --test` grading as the other tiers; add more fixtures to any tier the
same way.

### Running against external coding agents

`bench/src/external-agent.ts` drives Claude Code, opencode, or Cursor
headlessly (full-auto flags — `--dangerously-skip-permissions` /
`--force --trust`) against a freshly cloned greenfield scaffold, extracts the
resulting patch with the same `extractPatch()` Artificer's own driver uses,
and feeds it through the *same, unmodified* `eval-greenfield.ts`/`report.ts` —
so results are directly comparable to Artificer's own greenfield reports.

```bash
pnpm bench:greenfield:claude-code            # mini tier
pnpm bench:greenfield-hard:claude-code       # hard tier
pnpm bench:greenfield:opencode-cli
pnpm bench:greenfield:cursor
```

**Never run more than one of these (or `pnpm bench:greenfield*`) against the
same suite concurrently** — even though `loadGreenfieldTask` locks and
privately clones the shared scaffold cache to avoid data races (see
`greenfield.ts`), running many agents at once will still contend for the same
`bench/results/...` output paths and make cost/timing comparisons noisy. Run
them one at a time.

## Outputs (`results/`)

| File | Produced by | Contents |
| --- | --- | --- |
| `predictions.jsonl` | `bench` | One `{instance_id, model_name_or_path, model_patch}` per instance |
| `attempts.json` | `bench` | Per-instance outcome, duration, patch size, tokens/USD/runs |
| `runs/<id>.json` | `bench` | Per-instance call tree (trajectory) for the runtime UI's benchmark run page |
| `instances.json` | `bench` | The resolved instances that were run |
| `run-config.json` | `bench` | The exact config used |
| `eval-report.json` | `bench:eval` or `bench:eval:deepswe` | Resolved/unresolved verdicts |
| `history/<timestamp>.json` | `bench` | Archived run summaries for cross-run efficiency charts |
| `report.md` / `report.json` | `bench:report` | Merged correctness + cost report |

## Caveats

- **Determinism:** isolated data dir per instance, concurrency 1, pinned
  models, capped runs, and a timeout. LLMs are still non-deterministic, so a
  report reflects a single run.
- **Test environment:** the agent works on a plain clone at the base commit
  (no preinstalled project dependencies), so its own in-task test runs may be
  unreliable. Correctness is judged solely by the isolated SWE-bench evaluator,
  which builds the proper per-instance image. A future enhancement could run
  the agent inside that image.
- **Patch extraction:** the candidate patch is `git diff` of the workspace
  against the base commit (staged, including new files). If the agent edited
  test files, those changes are included in the patch but the evaluator applies
  the official test patch on top when grading.
