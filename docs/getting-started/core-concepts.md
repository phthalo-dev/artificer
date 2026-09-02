# Core Concepts

Key terms used throughout the Artificer documentation.

## Identity repo vs execution state

The **identity repo** (your `my-agent/` directory) contains everything that defines the agent: its config, instructions, custom tools, channel definitions, and the memories it writes over time. This is a git repo — push it to GitHub to back it up, clone it to move the agent.

**Execution state** lives under `~/.artificer/<agent-name>/` by default: inbound messages, workstream data, cloned workspace repos, and run logs. This is ephemeral — it rebuilds from running the agent and is not committed.

You can override the execution directory with `ARTIFICER_EXEC_DIR=./.artificer` in `.env` if you prefer everything co-located (then uncomment `.artificer/` in `.gitignore`).

## Workstreams

A workstream is the unit of ongoing work. When you ask the agent to do something non-trivial, it creates a workstream: plan, tasks, worker runs, and reviews all live there. The agent works through tasks in sequence, reviewing each result before moving to the next.

You can have multiple workstreams running concurrently (controlled by `RUNTIME_CONCURRENCY`). Each runs in its own isolated workspace directory (a fresh clone of the relevant repo). Planner, worker, and reviewer prompts replay hash-stable context section bodies when content is unchanged — see [Hash-stable context sections](../introduction/how-it-works.md#hash-stable-context-sections).

## Roles

Each role is one LLM call (a tool-use loop). Roles never overlap during a single invocation — each finishes before the next is spawned.

- **communicator** — the entry point for every inbound message; routes intent or replies directly
- **orchestrator** — manages a workstream: dispatches tasks, re-invokes itself after each result
- **planner** — produces `plan.md` — the workstream's list of tasks
- **reviewer** — reviews the plan or completed work and records notes
- **worker** — implements one focused unit (one file, one PR, one investigation)

Each role picks a model by tier (`low`/`medium`/`high`). Override with `RUNTIME_TIER_<ROLE>` env vars.

## Channels

Channels are how messages get into the agent. The web UI at `http://localhost:4100` is always available. Add `agent/channels/slack.ts` or `agent/channels/discord.ts` to enable those — see the [Slack & Discord guide](../guides/slack-discord-connections.md).

You can also write custom channels using `defineChannel()` from `@artificer-ai/runtime`.

## Executors

The executor is what actually does the worker role's work. By default it's Artificer's internal LLM tool loop (shell, file read/write, git, web fetch). You can swap it for any MCP-compatible CLI agent like Claude Code, Cursor, or Qwen Code — see the [Custom CLI Executors guide](../guides/custom-cli-executor.md).

The executor only applies to the worker role. The communicator, orchestrator, planner, and reviewer always use the internal loop.

## Memories

Memories are markdown files the agent writes to `identity/memories/` during its work — notes it wants to keep across conversations. Because the identity repo is git-tracked, memories are versioned and portable. You can also seed initial memories manually by adding files to that directory before starting the agent.
