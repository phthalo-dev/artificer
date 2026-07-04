# Environment Variables

Environment variables configure the agent at runtime; set them in `.env` (development) or as container/platform secrets (production).

Where a variable lists an "Alias", that alias exists for compatibility with earlier naming (e.g. `ANTHROPIC_MODEL*`, `GH_TOKEN`) and is read as a fallback — prefer the primary name (`LLM_*`, `GITHUB_TOKEN`) in new configs.

## LLM / model configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM_API_KEY` | Yes | — | LLM provider API key. Aliases: `ZEN_API_KEY`, `ANTHROPIC_API_KEY` (tried in that order) |
| `LLM_BASE_URL` | No | `https://opencode.ai/zen/v1` | LLM base URL (OpenAI-compatible) |
| `MODEL_PRESET` | No | `go-economy` | Model preset ID that seeds all three tiers; overridden by individual tier vars |
| `LLM_MODEL` | No | preset default | Model ID for the medium tier (planner, reviewer). Alias: `ANTHROPIC_MODEL` |
| `LLM_MODEL_LOW` | No | preset default | Model ID for the low tier (communicator). Alias: `ANTHROPIC_MODEL_LOW` |
| `LLM_MODEL_HIGH` | No | preset default | Model ID for the high tier (worker). Alias: `ANTHROPIC_MODEL_HIGH` |
| `RUNTIME_TIER_COMMUNICATOR` | No | `low` | Override communicator role model tier (`low`, `medium`, or `high`) |
| `RUNTIME_TIER_ORCHESTRATOR` | No | `low` | Override orchestrator role model tier |
| `RUNTIME_TIER_PLANNER` | No | `medium` | Override planner role model tier |
| `RUNTIME_TIER_REVIEWER` | No | `low` | Override reviewer role model tier |
| `RUNTIME_TIER_WORKER` | No | `medium` | Override worker role model tier |

## GitHub identity

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | For git/PR work | — | GitHub PAT for the agent account. Alias: `GH_TOKEN` |
| `GITHUB_USER_NAME` | No | Derived from token | Commit author name; auto-detected from the GitHub account when `IDENTITY_REPO` is used |
| `GITHUB_USER_EMAIL` | No | Derived from token | Commit author email; auto-detected from the GitHub account when `IDENTITY_REPO` is used |
| `GITHUB_WATCH_INTERVAL_MS` | No | — | Poll interval (ms) for the agent's own PRs and notifications; absent or `0` disables watching |
| `IDENTITY_REPO` | Container deploys | — | GitHub repo to clone at boot (`owner/repo`) |
| `IDENTITY_DIR` | With `IDENTITY_REPO` | `/data/identity` | Where to clone the identity repo |

## Runtime behavior

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `4100` | HTTP port |
| `AGENT_NAME` | No | `Artificer` | Override agent name (normally comes from `artificer.config.ts`) |
| `ARTIFICER_EXEC_DIR` | No | `~/.artificer/<name>` | Directory for execution artifacts (runs, workstreams, workspace) |
| `ARTIFICER_IDENTITY_DIR` | No | current working directory | Root of the identity repo (config, tools, memories); defaults to `cwd` when not set |
| `RUNTIME_CONCURRENCY` | No | `2` | Max concurrent in-flight LLM calls across all workstreams |
| `RUNTIME_MAX_ITERATIONS` | No | `24` | Max tool-use iterations allowed within a single role call |
| `RUNTIME_MAX_PLANNER_ITERATIONS` | No | `18` | Iteration cap for the planner role specifically |
| `RUNTIME_MAX_RUN_MS` | No | `420000` | Hard wall-clock cap (ms) for a single call before aborting generation |
| `RUNTIME_MAX_RUNS_PER_WORKSTREAM` | No | `60` | Max total LLM calls per workstream |
| `RUNTIME_RESUME_ON_STARTUP` | No | `true` | Re-invoke the orchestrator for workstreams interrupted by a restart; set to `false` to disable |
| `ARTIFICER_VERBOSE` | No | — | Enable verbose tool logging in `dev` mode; set to `true` to enable |

## Diagnostics (post-edit)

Post-edit diagnostics run language checkers after file edits and feed errors back to the model.

| Variable | Required | Default | Description |
|---|---|---|---|
| `RUNTIME_DIAGNOSTICS` | No | `true` | Enable post-edit diagnostics; set to `false` to disable |
| `RUNTIME_DIAGNOSTICS_TIMEOUT_MS` | No | `20000` | Timeout (ms) for each diagnostic run |
| `RUNTIME_DIAGNOSTICS_MAX_PER_FILE` | No | `20` | Maximum diagnostic errors reported per file |
| `RUNTIME_DIAGNOSTICS_TYPESCRIPT` | No | `true` | Enable TypeScript diagnostics; set to `false` to disable |

## Context borrowing

| Variable | Required | Default | Description |
|---|---|---|---|
| `RUNTIME_MICROCOMPACT_ENABLED` | No | `true` | Enable micro-compaction of tool results to save context; set to `false` to disable |
| `RUNTIME_FILE_CACHE_MAX_ENTRIES` | No | `64` | Max entries in the in-process file content cache |
| `RUNTIME_REQUIRE_RG` | No | `true` | Require ripgrep (`rg`) for search; set to `false` to fall back to slower alternatives |
| `RUNTIME_TOOL_RESULT_MAX_CHARS` | No | `12000` | Max characters per tool-use result before truncation |
| `RUNTIME_TOOL_RESULT_MAX_PER_RUN_CHARS` | No | `80000` | Max total tool-result characters accumulated across a single call |

## Quota and spend

| Variable | Required | Default | Description |
|---|---|---|---|
| `QUOTA_DAILY_BUDGET_USD` | No | — | Daily spend cap in dollars on the primary route's budget window |
| `QUOTA_RESERVE_PERCENT` | No | `10` | Percentage of the quota budget held in reserve for communicator replies near the cap |
| `QUOTA_ON_EXHAUSTED` | No | — | Action when the primary route is exhausted: `wait` or `failover` (requires a second route configured) |

## Security

| Variable | Required | Default | Description |
|---|---|---|---|
| `ARTIFICER_API_KEY` | Production | — | Bearer token for API authentication; if unset, auth is disabled (suitable for local development only) |

## Channels

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | Slack | — | Slack bot OAuth token (`xoxb-...`); used to post replies and update the bot's status |
| `SLACK_SIGNING_SECRET` | Slack | — | Slack webhook signing secret; used to verify incoming event payloads |
| `DISCORD_PUBLIC_KEY` | Discord | — | Discord app public key; used to verify incoming interaction signatures |
| `DISCORD_APP_ID` | Discord | — | Discord application ID; used when editing deferred interaction responses |

## A note on `.env` vs container secrets

Variables in `.env` are loaded automatically by the runtime from the root of the identity repo. In containers or production environments, set them as platform secrets instead (Fly.io secrets, Docker env flags, Kubernetes secrets). `.env` is gitignored and should never be committed.
