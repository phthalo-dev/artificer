# Workspace Run/Service Scripts Design

**Date:** 2026-09-08
**Status:** Approved

## Problem

Two independent competitor products — Paseo (`docs/research/2026-09-08-paseo-comparison.md`) and Conductor (`docs/research/2026-09-08-conductor-comparison.md`) — both give a workspace a declared, named way to start a long-lived dev server/service with an allocated port, and both were arrived at independently. Artificer has no equivalent: `run_shell` (`packages/runtime/src/tools/shell.ts`) is strictly run-to-completion with a hard timeout and SIGKILL, so there is no primitive for "start the app and leave it running."

This is a real, already-documented gap: `CLAUDE.md`'s own house rule — "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete" — has no runtime mechanism behind it today. This spec closes the "start the dev server" half. Actual in-browser verification (screenshots, navigation) is a separate follow-on (see Out of Scope) because it requires a multimodal tool-result change this spec does not make.

## Scope

- A new `packages/runtime/src/services/` module owning process spawn/track/kill and port allocation for named services, scoped per workstream.
- A target-repo config file (`.artificer/workspace.json`) declaring named services; an optional override block in `artificer.config.json` (identity repo).
- Four new tools — `start_service`, `stop_service`, `list_services`, `check_service` — available to the `worker` and `reviewer` roles only.
- A teardown hook on workstream terminal-state transitions (`done` / `failed` / `cancelled`).
- Best-effort reattach on runtime restart: reconcile tracked PIDs, no auto-restart of dead services.
- No changes to `run_shell`, existing executors, or the tool-approval-policy mechanism.

## Config Shape

### Target repo: `.artificer/workspace.json`

Committed alongside the project's own code — the same file whether a human or Artificer runs the project.

```json
{
  "services": {
    "web": {
      "setup": "npm install",
      "run": "npm run dev",
      "teardown": "",
      "portRange": [3000, 3009]
    },
    "worker": {
      "run": "npm run worker",
      "portRange": [3010, 3019]
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `setup` | no | Runs once per workstream, before the first `run`. Non-zero exit aborts `start_service` before `run` ever executes. |
| `run` | yes | The long-lived process. Spawned detached and `unref()`'d so it survives if the runtime process itself restarts. |
| `teardown` | no | Runs once, after the process is killed (via `stop_service` or auto-teardown). Failure is logged only — never blocks the workstream's terminal-state transition. |
| `portRange` | yes | `[min, max]` inclusive. The runtime allocates the next free port in this range and records which port each service instance landed on. |

### Identity repo override: `artificer.config.json`

```jsonc
{
  "workspaceServices": {
    "disabled": ["worker"],
    "overrides": {
      "web": { "portRange": [4000, 4009] }
    }
  }
}
```

`disabled` removes a named service from the tool-visible set entirely (as if it weren't declared). `overrides` deep-merges onto the target-repo definition for the named service — today this only needs to support `portRange`, but the merge is field-by-field, not a full replace, so future fields extend cleanly.

### Injected environment variables

Every `setup`/`run`/`teardown` invocation gets:

| Var | Value |
|---|---|
| `ARTIFICER_SERVICE_NAME` | The service's name (`"web"`) |
| `ARTIFICER_SERVICE_PORT` | The allocated port |
| `ARTIFICER_SERVICE_URL` | `http://127.0.0.1:<port>` |
| `ARTIFICER_WORKSPACE_DIR` | Same value already passed as `workspaceDir` elsewhere |

## Tool Surface

All four tools are added to the `worker` and `reviewer` branches in `toolsForRole()` (`packages/runtime/src/tools/registry.ts`). None are approval-gated (`needsApproval` unset) — they only ever run commands the project itself already declared in a committed config file, the same trust boundary `run_shell` already operates inside.

| Tool | Input | Behavior |
|---|---|---|
| `start_service` | `{ name }` | Runs `setup` if not yet run for this workstream+service; spawns `run` detached, waits ~1-2s to catch an immediate crash; allocates a port; writes state; returns `{ status: "started" \| "already_running", port, url }` as a JSON string. Idempotent — a second call for an already-running service returns its existing port/url rather than erroring. |
| `stop_service` | `{ name }` | SIGTERM, 5s grace period, then SIGKILL if still alive; runs `teardown`. Idempotent no-op if already stopped. |
| `list_services` | `{}` | Returns `{ name, port, status }[]` for everything tracked on this workstream. Exists because the worker and reviewer are separate LLM calls — the reviewer needs a way to discover what the worker already left running without starting it itself. |
| `check_service` | `{ name }` | Looks up the port itself from this workstream's own service registry — **never accepts a caller-supplied host or port** — fetches `http://127.0.0.1:<port>`, returns HTTP status + a truncated body. Errors if `name` was never started. This is deliberately narrower than `fetch_url` (`packages/runtime/src/tools/fetch.ts`), which hard-blocks loopback/private ranges via `assertPublicUrl` (`packages/runtime/src/tools/url-guard.ts`) as an SSRF guard; `check_service` is the one place that guard is deliberately bypassed, and only because the port is resolved by the runtime itself from its own state, never from model input. |

## Data Flow

**`start_service("web")`:**
1. Resolve config: read `.artificer/workspace.json` from the workspace's repo root; apply `workspaceServices.overrides`/`disabled` from `artificer.config.json`; error if the name is unknown or disabled.
2. If no prior state for `(workstreamId, "web")`: run `setup` by calling the existing, unmodified `runShellCommand()` (`packages/runtime/src/tools/shell.ts`) — bounded, captures output. Non-zero exit → abort with that output as the error.
3. Allocate a port: scan `portRange` for the first port not already claimed by any tracked service across all workstreams (source of truth: the in-memory registry the engine rebuilds at startup, backed by every workstream's `.artificer-services.json`).
4. `spawn(run, { cwd: workspaceDir, detached: true, env: {...processEnv, ARTIFICER_SERVICE_*}, stdio: ['ignore', logFd, logFd] })`, then `.unref()`. Stdout/stderr go to `<workstreamWorkspace>/.artificer-service-logs/<name>.log`, not into memory.
5. Wait ~1-2s; if the process has already exited, report failure with the log tail instead of "started."
6. Write `{ name, pid, port, startedAt, script }` to `<workstreamWorkspace>/.artificer-services.json`.
7. Return status/port/url.

**Runtime startup (reattach):** scan every workstream's `.artificer-services.json`; for each entry, `process.kill(pid, 0)` — throws `ESRCH` if dead. Alive → keep tracking (rebuild the in-memory registry entry; no live `ChildProcess` handle needed since detached processes are tracked purely by PID from here). Dead → mark stopped, drop the entry. No process is ever restarted automatically.

**Workstream terminal-state teardown:** the workstream-machine's transition into `done`/`failed`/`cancelled` calls `serviceManager.teardownWorkstream(workstreamId)`, which runs `stop_service` semantics for every still-tracked service on that workstream.

## Error Handling

| Case | Behavior |
|---|---|
| `setup` fails (non-zero exit) | Abort before `run`; return setup's captured output as the error. |
| `run` exits inside the crash-detection window | Report failure with the log tail; never report `"started"` for a dead process. |
| Port range exhausted | Clear error naming the configured range and current occupancy. |
| `teardown` fails | Log only; never blocks the workstream's terminal-state transition (same pattern as librarian-distill failures elsewhere in the codebase). |
| `check_service` for an unknown/never-started name | Error — no fallback port guessing. |
| `stop_service` for an already-stopped name | Idempotent no-op. |

## Files Changed

| File | Change |
|---|---|
| `packages/runtime/src/services/service-manager.ts` | New — spawn/track/kill, port allocation, state read/write |
| `packages/runtime/src/services/workspace-config.ts` | New — reads/merges `.artificer/workspace.json` + `workspaceServices` override |
| `packages/runtime/src/tools/services.ts` | New — the four tool definitions |
| `packages/runtime/src/tools/registry.ts` | Add the four tools to `worker`/`reviewer` branches |
| `packages/runtime/src/context.ts` | Add `services: ServiceManager` to `ToolContext` |
| `packages/runtime/src/engine/workstream-machine.ts` | Call `teardownWorkstream()` on terminal-state transition |
| `packages/runtime/src/engine/engine.ts` | Reattach scan on startup |
| `docs/reference/config.md` | Document `.artificer/workspace.json` and the `workspaceServices` override block |
| `docs/reference/roles.md` | Add the four tools to the worker/reviewer tool tables |

## Testing Plan

- Port allocator: range exhaustion, reuse after `stop_service`, no collision across two concurrent workstreams sharing a range.
- `service-manager`: spawn/kill/reattach against a mocked `child_process`, including the crash-detection window and the `process.kill(pid, 0)` reconcile path.
- Tool-level: all four tools, including a test asserting `check_service` refuses any name not present in the calling workstream's own registry (the SSRF-safety property).
- Integration: simulated runtime restart with one live and one already-dead PID recorded, verifying the reconcile marks only the dead one stopped.

## Out of Scope

- Real in-browser verification (Playwright, screenshots, navigation) and the multimodal tool-result pipeline change it requires — a separate follow-on design.
- A `concurrent`/`nonconcurrent` mutual-exclusion toggle between named services (Conductor has this; deferred until a real case shows two services in the same project genuinely can't coexist).
- Auto-restarting services that were running when the runtime last shut down.
- Idle-timeout auto-teardown (only terminal-state teardown is in scope for v1).
- Any change to `run_shell`, existing worker executors, or the tool-approval-policy mechanism.
