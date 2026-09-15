---
title: Roles Reference
description: Each role is a single LLM tool-use loop.
---

# Roles Reference

Each role is a single LLM tool-use loop. Roles are invoked by name; each has a fixed purpose, a default model tier, and a set of tools available to it.

## Roles overview

| Role | Purpose | Default tier | Tier override env var |
|---|---|---|---|
| communicator | Entry point for all inbound messages | low | `RUNTIME_TIER_COMMUNICATOR` |
| orchestrator | Manages a workstream: dispatches tasks, re-invokes itself after each result | low | `RUNTIME_TIER_ORCHESTRATOR` |
| planner | Produces `plan.md` for a workstream | medium | `RUNTIME_TIER_PLANNER` |
| reviewer | Reviews a plan or completed work, records notes | low | `RUNTIME_TIER_REVIEWER` |
| worker | Implements one focused unit of work | medium | `RUNTIME_TIER_WORKER` |
| librarian | Reads shared links and content, stores knowledge in memory | low | `RUNTIME_TIER_LIBRARIAN` |

Default tiers are from the `async-economy` preset (the default). Other presets assign different tiers — see [Model tiers](#model-tiers) below.

---

## Communicator

**Purpose.** The communicator is the only role that talks directly to a person. It receives every inbound message, determines intent, and routes it to the appropriate action: starting a workstream for coding or implementation tasks, checking status, steering an existing workstream with a note, ingesting reference material via the librarian, adjusting provider configuration, saving a fact or preference to memory, or replying directly to conversational messages. It also handles automated GitHub notifications (CI results, review comments, @-mentions) by routing them to the relevant workstream without replying to the person. The communicator does not implement code — it delegates all workstream work and replies once before stopping.

**Tools available:**
- `reply` — send a message back to the person
- `start_workstream` — create a new workstream for a coding or implementation goal
- `send_note` — deliver steering guidance to an existing workstream
- `learn` — spawn a librarian to read and store reference material
- `get_recent_messages` — read recent message history
- `get_status` — query workstream status
- `query_memories` — search stored memories
- `add_memory` — save a new memory (fact or preference)
- `get_provider_config` — read current provider and model configuration
- `update_provider_config` — update provider routing, model selection, or spend caps

**Inputs:** A message from a person (or a `[GitHub]`-prefixed automated notification from the GitHub activity watcher).

**Outputs:** Exactly one `reply` call per invocation, plus zero or more of: `start_workstream`, `send_note`, `learn`, `add_memory`, `update_provider_config`.

---

## Orchestrator

**Purpose.** The orchestrator owns a single workstream from start to finish. It is re-invoked each time something changes — the workstream is created, a child call (planner, worker, or reviewer) finishes, or the person sends a note. Each invocation reads the current state via `get_status`, decides the next step, and stops. The orchestrator does not write code itself; it delegates to planners, workers, and reviewers via `invoke_call`. It manages the sequence: cloning the repo and producing a plan first, reviewing the plan, dispatching worker calls to implement individual tasks, reviewing finished work, and finally marking the workstream done once there is concrete evidence of successful verification. It also handles blocked or failed child calls by providing more context, breaking tasks into smaller pieces, or escalating to the person.

**Tools available:**
- `get_status` — read workstream state, tasks, results, and reviews
- `invoke_call` — spawn a planner, worker, or reviewer call
- `update_status` — record progress and a running summary
- `query_memories` — search stored memories
- `add_memory` — save a new memory
- `record_finding` — record a cross-cutting finding
- `reply` — send a message to the person (e.g. when work is done or needs escalation)
- `read_plan` — read the current plan artifact
- `read_file` — read a file in the workspace
- `list_files` — list files in the workspace
- `grep` — search file contents by pattern
- `read_tool_result` — read a previous tool result by ID

**Inputs:** Workstream state (tasks, results, plan status, review records, running summary) read via `get_status`; optional user note.

**Outputs:** One or more `invoke_call` calls to spawn child roles, `update_status` calls to record progress, and a final `reply` when the workstream reaches a terminal state.

---

## Planner

**Purpose.** The planner investigates the workstream goal and produces a concrete, actionable `plan.md`. For repository tasks, it clones the repo first (if not already present), checks out the specified base commit when given, then reads the relevant source files using `read_file`, `list_files`, `grep`, and `glob` to understand the codebase. It identifies every distinct requirement stated in the goal, maps each to a specific file and change, and writes the plan with `write_plan` before stopping. Plans for bug fixes are short and precise (root-cause file, exact lines, verification command); plans for larger features list each file to change with concrete, independently-doable steps. The planner calls `write_plan` as its final action in every run — a run that investigates without writing a plan is considered a failure.

**Tools available:**
- `read_file` — read a file in the workspace
- `write_file` — create a new file
- `list_files` — list files in the workspace
- `edit_file` — make targeted edits to an existing file
- `grep` — search file contents by pattern
- `glob` — find files matching a path pattern
- `run_shell` — run build, test, or inspection commands
- `git` — run git commands
- `gh` — run GitHub CLI commands
- `write_plan` — write the plan artifact
- `read_plan` — read a previously written plan
- `get_status` — query workstream state
- `query_memories` — search stored memories (checked at start for standing preferences)
- `add_memory` — save a new memory
- `record_finding` — record a cross-cutting finding
- `read_tool_result` — read a previous tool result by ID

**Inputs:** Workstream goal and context (repoUrl, baseCommit, any user notes), workstream status from `get_status`.

**Outputs:** A `plan.md` artifact written via `write_plan`.

---

## Reviewer

**Purpose.** The reviewer critically examines either a plan or implemented work and records a structured verdict. It is read-only: it never edits files, runs `sed -i` or equivalent shell commands, or otherwise modifies the workspace. It reads the plan with `read_plan`, reads relevant source files, uses `grep` and `glob` to verify that changes are present and correct, and runs build or test commands to check the output. Every issue found is tagged with a severity (Critical, Important, or Minor). The reviewer calls `submit_review` with its notes, the stage reviewed (`plan` or `work`), the highest severity found, and `approved=true` only when there are no Critical or Important issues. A text-only verdict without `submit_review` does not count.

**Tools available:**
- `read_file` — read a file in the workspace
- `list_files` — list files in the workspace
- `grep` — search file contents by pattern
- `glob` — find files matching a path pattern
- `run_shell` — run build, test, or lint commands (read-only inspection)
- `git` — run git commands for inspection (`git show`, `git diff`)
- `gh` — run GitHub CLI commands
- `read_plan` — read the current plan artifact
- `submit_review` — record the review verdict
- `get_status` — query workstream state
- `query_memories` — search stored memories
- `record_finding` — record a cross-cutting finding
- `read_tool_result` — read a previous tool result by ID

**Inputs:** The plan artifact (via `read_plan`), workspace files, and build/test output.

**Outputs:** A review record written via `submit_review`, containing severity-tagged notes and an approval decision.

---

## Worker

**Purpose.** The worker implements a single focused unit of work as assigned by the orchestrator. It reads the relevant plan and source files first, then makes the required changes using `edit_file` (for existing files) and `write_file` (for new files). It follows test-driven development when the project supports it: writing a failing test first, verifying it fails for the expected reason, then writing the minimal code to make it pass. Before finishing, the worker runs the relevant build, test, or lint commands and reads their full output. It calls `report_status` with a summary of what it changed, the verification it ran, and any follow-up notes for the reviewer — a run without `report_status` is invisible to the orchestrator. The worker covers the full described behavior of the assigned task, not just the headline case.

**Tools available:**
- `read_file` — read a file in the workspace
- `write_file` — create a new file
- `list_files` — list files in the workspace
- `edit_file` — make targeted edits to an existing file
- `grep` — search file contents by pattern
- `glob` — find files matching a path pattern
- `run_shell` — run build, test, or lint commands
- `git` — run git commands (commit, push, branch)
- `gh` — run GitHub CLI commands (open PRs, comment)
- `read_plan` — read the current plan artifact
- `report_status` — record completion status and summary
- `get_status` — query workstream state
- `query_memories` — search stored memories
- `add_memory` — save a new memory
- `record_finding` — record a cross-cutting finding
- `update_status` — record progress to the workstream
- `read_tool_result` — read a previous tool result by ID

**Inputs:** The plan artifact (via `read_plan`), workstream state (via `get_status`), and the specific task assigned by the orchestrator.

**Outputs:** File edits (`edit_file`, `write_file`), git commits and optionally a pull request, and a `report_status` call with the completion summary.

---

## Librarian

**Purpose.** The librarian reads content shared by the person — a URL, pasted text, or reference material — and saves durable knowledge to long-term memory. It is not used during active coding workstreams; for repository tasks the planner and worker read source directly. When given a URL, it tries AI-friendly shortcuts first (`/llms.txt`, then appending `.md` to the URL) before falling back to fetching the raw HTML. It identifies durable, teachable facts (key APIs and their shapes, important concepts, gotchas), deduplicates against existing memories via `query_memories`, and saves 1–3 `add_memory` calls grouped by topic. It finishes with a `reply` listing what was saved and a brief takeaway, or reports that the fetch failed if the URL was unreachable.

**Tools available:**
- `fetch_url` — fetch a URL
- `reply` — send a summary to the person
- `query_memories` — search existing memories before saving
- `add_memory` — save a new memory (kind: `document`, `note`, or `preference`)

**Inputs:** A URL, pasted content, or other reference material passed in the task.

**Outputs:** One or more `add_memory` calls, then a `reply` summarizing what was saved.

---

## Model tiers

Roles run at one of three complexity tiers — `low`, `medium`, or `high` — which map to concrete model IDs via environment variables:

| Tier | Env var |
|---|---|
| low | `LLM_MODEL_LOW` (alias: `ANTHROPIC_MODEL_LOW`) |
| medium | `LLM_MODEL` (alias: `ANTHROPIC_MODEL`) |
| high | `LLM_MODEL_HIGH` (alias: `ANTHROPIC_MODEL_HIGH`) |

**Overriding a role's tier.** Set `RUNTIME_TIER_<ROLE>=<tier>` to change the tier for a specific role:

```
RUNTIME_TIER_WORKER=high
RUNTIME_TIER_PLANNER=high
```

**Per-call complexity override.** The orchestrator can also set a `complexity` value on each `invoke_call`. This overrides the role's default tier for that single invocation, letting the orchestrator route simple mechanical tasks to `low` and design or broad-reasoning tasks to `high` without changing the global tier configuration.

**Model presets.** The default tier assignments above are from the `async-economy` preset. Other presets (such as `quality-first`) assign different defaults — for example, `quality-first` runs the planner and worker at `high` and the orchestrator and reviewer at `medium`. Set `MODEL_PRESET` to select a preset; see the config reference for the full preset list.

---

## Tool access summary

| Tool | communicator | orchestrator | planner | reviewer | worker | librarian |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `reply` | yes | yes | | | | yes |
| `start_workstream` | yes | | | | | |
| `send_note` | yes | | | | | |
| `learn` | yes | | | | | |
| `get_recent_messages` | yes | | | | | |
| `get_provider_config` | yes | | | | | |
| `update_provider_config` | yes | | | | | |
| `get_status` | yes | yes | yes | yes | yes | |
| `invoke_call` | | yes | | | | |
| `update_status` | | yes | | | yes | |
| `query_memories` | yes | yes | yes | yes | yes | yes |
| `add_memory` | yes | yes | yes | | yes | yes |
| `record_finding` | | yes | yes | yes | yes | |
| `read_tool_result` | | yes | yes | yes | yes | |
| `read_file` | | yes | yes | yes | yes | |
| `write_file` | | | yes | | yes | |
| `list_files` | | yes | yes | yes | yes | |
| `edit_file` | | | yes | | yes | |
| `grep` | | yes | yes | yes | yes | |
| `glob` | | | yes | yes | yes | |
| `run_shell` | | | yes | yes | yes | |
| `git` | | | yes | yes | yes | |
| `gh` | | | yes | yes | yes | |
| `read_plan` | | yes | yes | yes | yes | |
| `write_plan` | | | yes | | | |
| `submit_review` | | | | yes | | |
| `report_status` | | | | | yes | |
| `fetch_url` | | | | | | yes |
