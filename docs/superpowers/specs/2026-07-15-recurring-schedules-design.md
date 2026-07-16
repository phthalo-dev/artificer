# Recurring Schedules Design

**Date:** 2026-07-15
**Status:** Draft

## Problem

Artificer is event-driven: work arrives via chat, channels, API, or GitHub
polling. There is no first-class way for users (or the agent) to define
recurring work — maintenance loops (“prune memories weekly”) or proactive
heartbeats (“check in every morning and decide if anything needs attention”).

Earlier designs explicitly deferred cron/KAIROS-style surfaces. This spec
introduces a focused, identity-backed schedule system that reuses existing
message and workstream entry points.

## Goals

- Let humans and the agent define recurring tasks as files in the identity repo
- Support both **heartbeats** (wake the communicator) and **maintenance jobs**
  (start a workstream) via a per-schedule `action`
- Support **intervals** (`every`) and **cron** (with timezone)
- Skip a tick when the previous run for that schedule is still in flight
- Let the agent create/edit/pause/delete schedules via tools
- Periodically **pull identity from origin** so humans can override schedules
  (and other identity) on GitHub without redeploying

## Non-goals (V1)

- Queue-on-overlap or parallel runs for the same schedule
- Natural-language schedule parsing
- UI schedule editor
- Per-schedule concurrency / quota overrides
- Catch-up / backfill for ticks missed while the runtime was down
- Replacing `github.watchInterval` (stays separate)

## Approach

**Schedule files + ScheduleRunner**, modeled after roles/skills discovery and
the GitHub watch timer:

1. Definitions live in `agent/schedules/<id>.md` (git-backed identity)
2. A `ScheduleRunner` polls for due schedules and fires into existing engine APIs
3. Last-fired / in-flight state lives in the **runtime data store** (not git)
4. Agent tools write schedule files and reload the runner
5. A separate **identity pull timer** keeps the working tree aligned with origin

---

## Schedule file format

**Location:** `agent/schedules/<id>.md`  
**Id:** filename stem (must be path-safe; no traversal)

### Frontmatter

| Field | Required | Notes |
|-------|----------|--------|
| `name` | no | Display name; defaults to id |
| `every` *xor* `cron` | one required | Duration string or 5-field cron |
| `timezone` | no | IANA tz for `cron` evaluation; default `UTC`. Ignored for `every`. |
| `action` | yes | `communicator` \| `workstream` |
| `enabled` | no | default `true` |

Markdown body (after frontmatter) is required: prompt / instructions for that tick.

Duration strings match existing config parsing (`30s`, `5m`, `1h`, `1d`).

### Examples

Heartbeat:

```markdown
---
name: Morning check-in
every: 1d
action: communicator
enabled: true
---
It's a new day. Review open workstreams, recent messages, and whether anything
needs attention. Act only if useful; otherwise do nothing.
```

Maintenance workstream:

```markdown
---
name: Weekly memory prune
cron: 0 9 * * 1
timezone: America/Los_Angeles
action: workstream
enabled: true
---
Review identity memories older than 90 days. Propose pruning stale or duplicate
entries; do not delete without clear justification.
```

Invalid files are skipped on load with a warning; other schedules keep running.

---

## Components

| Piece | Responsibility |
|-------|----------------|
| Loader | Discover/parse `agent/schedules/*.md` (same frontmatter style as roles) |
| ScheduleRunner | Poll loop, due checks, overlap skip, fire actions, reload |
| Runtime state | Persist `lastFiredAt` (and related) per schedule id in data store |
| Schedule tools | Agent CRUD + pause/resume + list with next-due metadata |
| Identity pull timer | Periodic `git pull --rebase` + reload schedule definitions |

---

## ScheduleRunner behavior

### Lifecycle

- Started with the runtime (alongside GitHub watch).
- On start: load schedules from disk; restore `lastFiredAt` from the data store.
- Tick cadence: fixed short poll (e.g. every 30s) asking “is anything due?” —
  not one timer per schedule. Cheap to reload after file or pull changes.

### Due logic

- **`every`:** due when `now >= lastFiredAt + interval`. If never fired, wait
  **one full interval after start** before the first fire (avoids restart storms).
- **`cron`:** due when the current wall-clock minute matches a cron boundary in
  the schedule’s timezone and `lastFiredAt` is before that boundary.
- **`enabled: false`:** ignored.
- **Missed ticks while down:** no backfill — wait for the next cron boundary or
  the next full interval after restart.

### Overlap

- Per schedule id, track `inFlight`.
- If due and in-flight → **skip** (do not queue).
- Clear in-flight when the communicator run finishes or the workstream reaches a
  terminal state (including failure).
- Process crash mid-flight: on restart treat as not in-flight; `lastFiredAt`
  was already updated so the schedule does not immediately re-fire.

### Actions

| `action` | Behavior |
|----------|----------|
| `communicator` | `engine.receiveMessage(...)` with a tagged prompt (e.g. prefix `[schedule:<id>]`) so the communicator treats it as a scheduled wake, not human chat |
| `workstream` | `engine.createDirectWorkstream(...)` with the schedule body as the goal; title derived from `name` |

Scheduled fires use the same engine paths as normal work, so scheduler
concurrency and quota pause/resume apply unchanged.

### Persistence

Store per schedule id in runtime data (not identity git), at minimum:

```ts
{ scheduleId: string; lastFiredAt: number }
```

Update `lastFiredAt` when the tick is **accepted** (before work starts), so a
long run + crash does not hammer retries.

If the engine rejects the fire entirely (e.g. cannot enqueue), do **not** update
`lastFiredAt`; retry on a later tick. Once accepted, skip-while-in-flight applies.

### Reload

Reload definitions when:

- Agent schedule tools write/delete a file
- Identity pull completes successfully
- Explicit reload hook (if needed for tests)

Changing `every` / `cron` does **not** reset `lastFiredAt` unless the schedule
id is removed and recreated.

---

## Identity pull

### Config

Add `identity.pullInterval` (duration string, e.g. `"5m"`).

- Absent / unset → pull disabled (same pattern as `github.watchInterval`)
- Resolved to `pullIntervalMs` on `RuntimeConfig` / identity config

### Behavior

Independent timer at runtime startup:

1. If the identity working tree has uncommitted changes and `autoCommit` is on,
   commit them first (same path as memory/schedule writes)
2. `git pull --rebase` on configured remote/branch (reuse `IdentityGitSync` /
   `buildGitEnv`)
3. Git updates the whole identity repo (schedules, roles, memories, etc.)
4. For V1, **hot-reload** schedule definitions after a successful pull; other
   identity surfaces keep their existing reload semantics
5. On failure: log and continue — never crash the runtime

### Conflict policy

Human override via origin should land cleanly when the tree is clean:

1. Agent writes commit promptly via existing autoCommit (and push if autoPush)
2. Pull timer commits any leftover dirty state when autoCommit is on, then
   `pull --rebase`
3. On rebase conflict: abort rebase, leave the working tree, log loudly, **do
   not** auto-resolve. Keep last successfully loaded schedule definitions until
   a human or the agent fixes the conflict

Document that humans editing on GitHub should expect schedule changes to appear
within about one pull interval when the tree is clean.

Pull currently only happens opportunistically before push on memory writes;
this timer makes inbound human edits first-class.

---

## Agent tools

Communicator-facing (and any role allowed to write identity):

| Tool | Effect |
|------|--------|
| `list_schedules` | List loaded schedules + next due / last fired / in-flight / enabled |
| `upsert_schedule` | Write/update `agent/schedules/<id>.md` (validate frontmatter), commit via identity git sync when enabled, reload runner |
| `set_schedule_enabled` | Flip `enabled` in frontmatter (pause/resume without deleting) |
| `delete_schedule` | Remove file, drop runtime state for that id, reload |

### Validation (`upsert_schedule`)

- Exactly one of `every` | `cron`
- Valid `action`
- Parseable duration / cron
- Reject path traversal / unsafe ids
- Non-empty body

---

## Observability

- Log each fire: schedule id, action, skipped-overlap vs started
- `list_schedules` exposes last fired / next due for the agent
- Optional thin `GET /api/schedules` for operators (nice-to-have if cheap; not
  blocking for V1)

---

## Errors

| Case | Behavior |
|------|----------|
| Invalid schedule file | Skip file, warn, keep others |
| Fire throws after accept | Clear in-flight; keep `lastFiredAt`; next due per schedule |
| Fire rejected before accept | Do not stamp `lastFiredAt`; retry later |
| Identity pull failure | Log; retry next interval; schedules keep last good load |
| Rebase conflict | Abort; log; no auto-resolve |

---

## Testing

- **Unit:** frontmatter parse/validate; due logic for `every` and cron+timezone;
  skip-on-overlap; `lastFiredAt` stamp timing; first-fire waits one full interval
- **Integration:** tool upsert → file on disk → runner reloads → fake clock
  advances → communicator or workstream path invoked
- **Pull:** mock git pull that changes a schedule file → reload picks up new
  cron/body

---

## Implementation sketch

Likely touch points (not exhaustive):

- `packages/runtime/src/storage/identity-layout.ts` — `schedulesDir`
- `packages/runtime/src/discover/` — discover + load schedules
- `packages/runtime/src/engine/schedule-runner.ts` — poll + fire
- `packages/runtime/src/storage/` — persist last-fired state
- `packages/runtime/src/storage/identity-git-sync.ts` — expose pull for timer;
  commit schedule writes if not already covered
- `packages/runtime/src/tools/` — schedule tools + registry
- `packages/runtime/src/api/types.ts` + schema + `config.ts` —
  `identity.pullInterval`
- Runtime startup wiring (next to GitHub watch)

---

## Decision summary

| Topic | Decision |
|-------|----------|
| Definition store | Identity files `agent/schedules/*.md` |
| Timing | `every` and `cron` (+ timezone) |
| Actions | Per schedule: `communicator` or `workstream` |
| Overlap | Skip |
| Agent management | Tools mutate files + reload |
| Human override | Built-in `identity.pullInterval` pull from origin |
| Runtime state | Data store, not git |
| Missed ticks | No backfill |
