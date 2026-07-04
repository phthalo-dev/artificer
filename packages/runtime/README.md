# @artificer-ai/runtime

A containerized agent runtime. It runs as a single web server that _is_ an agent
entity: you talk to it like a person (send it messages), it does work using its
own credentials, and it persists everything as files on disk.

Unlike a single long "conversation" with a model, the runtime orchestrates many
small, hierarchical LLM calls.

## The orchestration model

Every role is one LLM call (an Anthropic tool-use loop). The shared
`orchestrator` tool lets any call query system state and spawn child calls,
which is what enables arbitrary depth.

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

- **communicator** — the only role that talks to the outside world; routes intent.
- **orchestrator** — owns a workstream, deals out work, re-invoked with each result.
- **planner** — produces a plan artifact (`plan.md`).
- **reviewer** — reviews a plan or work and records notes.
- **worker** — implements a single focused unit (usually one file).

### Per-call model selection

Each call picks a model by complexity tier rather than using one model
everywhere. Defaults: communicator=`low`, orchestrator=`medium`, planner=`high`,
reviewer=`medium`, worker=`high`. Tiers map to model ids via `ANTHROPIC_MODEL`
(medium), `ANTHROPIC_MODEL_LOW`, and `ANTHROPIC_MODEL_HIGH`. Override a role's
tier with `RUNTIME_TIER_<ROLE>` (e.g. `RUNTIME_TIER_WORKER=medium`), and the
orchestrator can dynamically set `complexity` per spawned call via `invoke_call`.
The model used is recorded on each run, so `GET /usage` breaks cost down by model.

## Storage layout (under `ARTIFICER_DATA_DIR`)

```
messages/                 conversation with the outside world (one file per message)
workstreams/<id>/
  workstream.json         status + running summary
  plan.md                 planner artifact
  tasks/<taskId>.json     unit-of-work records
  reviews/<reviewId>.json reviewer notes
runs/<runId>.json         full record of every LLM call (role, task, tool calls, output)
memories/                 long-term notes the agent can query
workspace/<id>/           per-workstream working directory (repos, edited files)
```

## HTTP API

- `POST /messages` `{ "content": "..." }` — send the agent a message (async).
- `GET /messages` — full conversation history.
- `GET /state` — high-level snapshot: workstreams, queue, what's running now.
- `GET /workstreams` / `GET /workstreams/:id` — workstream detail (tasks, reviews, plan, runs).
- `GET /events` — Server-Sent Events stream of state changes (for a future UI).
- `GET /health`.

## Run locally

```bash
cp .env.example .env   # set ANTHROPIC_API_KEY
pnpm install
pnpm dev               # http://localhost:4100
```

Send it a message:

```bash
curl -X POST localhost:4100/messages \
  -H 'content-type: application/json' \
  -d '{"content":"What are you currently working on?"}'

curl localhost:4100/state
```

## Run in a container

```bash
pnpm docker:build
docker compose up
```

Work history persists in the `runtime-data` volume (mounted at `/data`).

## Configuration

See `.env.example`. Key variables: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`ARTIFICER_DATA_DIR`, `PORT`, `RUNTIME_CONCURRENCY`, `RUNTIME_MAX_ITERATIONS`,
`RUNTIME_MAX_RUNS_PER_WORKSTREAM`, `AGENT_NAME`.

## Benchmarking

`bench/` runs SWE-bench/DeepSWE-style task suites against a preset (model tiers,
concurrency, executor) and grades the results. See `bench/README.md` for the
full task/preset/eval workflow; `pnpm bench:full:swebench` runs a full
run-eval-report cycle end to end.
