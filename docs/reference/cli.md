# CLI Reference

The Artificer CLI (`artificer`) manages the agent lifecycle.

## `artificer init <name>`

**Synopsis:**
```
artificer init <name>
```

Scaffolds a new agent identity repo in a directory named `<name>`.

**What gets created:**
```
<name>/
├── artificer.config.json
├── agent/
│   ├── instructions.md
│   ├── tools/
│   ├── channels/
│   └── skills/
├── identity/
│   └── memories/
├── package.json
├── .env
└── .env.example
```

A `Dockerfile` and `.dockerignore` are also written for container deployments.

**Arguments:**

| Argument | Description |
|---|---|
| `name` | Name of the agent and the directory to create |

**After running:** `cd <name> && npm install`, then edit `.env` to add your API keys, then run `artificer dev`.

---

## `artificer dev`

**Synopsis:**
```
artificer dev [directory]
```

Starts the agent in development mode. API authentication is disabled — no `ARTIFICER_API_KEY` is required. Loads the identity from the given directory (default: current directory).

**Arguments:**

| Argument | Description |
|---|---|
| `directory` | Path to the agent identity repo (default: current directory) |

**Environment variables read at startup:**

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4100` | HTTP port |
| `LLM_API_KEY` | — | LLM provider API key (required for the agent to respond) |
| `LLM_BASE_URL` | `https://opencode.ai/zen/go/v1` | LLM base URL |
| `LLM_MODEL` | preset default | Medium-complexity tier model (planner, reviewer) |
| `LLM_MODEL_LOW` | preset default | Low-complexity tier model (communicator) |
| `LLM_MODEL_HIGH` | preset default | High-complexity tier model (worker) |
| `MODEL_PRESET` | `go-economy` | Model preset name |
| `AGENT_NAME` | value in `artificer.config.json` | Overrides the agent name |
| `GITHUB_TOKEN` | — | GitHub token for git push, `gh pr create`, and PR watching |
| `GITHUB_WATCH_INTERVAL_MS` | — | Poll interval for the agent's own PRs (milliseconds) |
| `ARTIFICER_EXEC_DIR` | `~/.artificer/<name>` | Where runs, workstreams, and workspace are stored |
| `ARTIFICER_IDENTITY_DIR` | `.` | Root of the identity repo |
| `ARTIFICER_VERBOSE` | — | Set to `true` to log tool calls |
| `RUNTIME_CONCURRENCY` | `2` | Maximum parallel LLM calls |
| `RUNTIME_MAX_RUNS_PER_WORKSTREAM` | `60` | Maximum runs per workstream |
| `RUNTIME_MAX_ITERATIONS` | `24` | Tool-use iterations per LLM call |
| `RUNTIME_RESUME_ON_STARTUP` | — | Set to `true` to resume interrupted workstreams on restart |
| `QUOTA_DAILY_BUDGET_USD` | `10` | Zen failover daily-budget window limit |
| `QUOTA_RESERVE_PERCENT` | `10` | Percentage held for communicator replies near cap |
| `QUOTA_ON_EXHAUSTED` | `wait` | Behavior when quota is exhausted: `wait` or `failover` |
| `SLACK_SIGNING_SECRET` | — | Slack channel signing secret |

**Startup output:**
```
[artificer] <agent-name> ready

  API   http://localhost:4100/api
  UI    http://localhost:4100
  SSE   http://localhost:4100/events

  identity  /path/to/identity
  exec      /path/to/exec-state
```

---

## `artificer start`

**Synopsis:**
```
artificer start [directory]
```

Starts the agent in production mode. API authentication is enforced. Supports `IDENTITY_REPO` for container deployments where the identity lives in a GitHub repository.

**Arguments:**

| Argument | Description |
|---|---|
| `directory` | Path to the agent identity repo (default: current directory; overridden by `IDENTITY_REPO`) |

**Environment variables read at startup:**

| Variable | Default | Description |
|---|---|---|
| `ARTIFICER_API_KEY` | — | Bearer token for API authentication; warns if not set, does not block |
| `IDENTITY_REPO` | — | GitHub repo (`owner/repo`) to clone at startup; when set, overrides `directory` |
| `GITHUB_TOKEN` | — | Required when `IDENTITY_REPO` is set; used to clone the repo and for git identity; `GH_TOKEN` is accepted as an alias |
| `IDENTITY_DIR` | `/data/identity` | Where to clone the identity repo |
| `GITHUB_USER_NAME` | derived from `GITHUB_TOKEN` account | Commit author name |
| `GITHUB_USER_EMAIL` | derived from `GITHUB_TOKEN` account | Commit author email |
| `PORT` | `4100` | HTTP port |

In addition, all LLM and runtime environment variables accepted by `artificer dev` apply to `artificer start` as well.

**Difference from `dev`:** authentication is enforced via `ARTIFICER_API_KEY`, and `IDENTITY_REPO` is supported for cloning the identity from GitHub on startup.
