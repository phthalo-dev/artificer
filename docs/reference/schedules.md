# Schedules Reference

Recurring schedules let you define work that runs on a timer — daily check-ins, weekly maintenance, or any cron-based job. Definitions live as markdown files in the identity repo at `agent/schedules/<id>.md`, the same way roles and skills are discovered from disk.

The runtime polls for due schedules and fires them into existing engine paths: either waking the **communicator** (heartbeat) or starting a **workstream** (maintenance job). The agent can also create, edit, pause, and delete schedules via built-in tools.

---

## Schedule file format

**Location:** `agent/schedules/<id>.md`  
**Id:** filename stem (must be path-safe; no traversal)

### Frontmatter

| Field | Required | Notes |
|-------|----------|--------|
| `name` | no | Display name; defaults to id |
| `every` *xor* `cron` | one required | Duration string or 5-field cron |
| `timezone` | no | IANA timezone for `cron` evaluation; default `UTC`. Ignored for `every`. |
| `action` | yes | `communicator` \| `workstream` |
| `enabled` | no | default `true` |

The markdown body (after frontmatter) is required: prompt / instructions for that tick.

Duration strings match config parsing: `"30s"`, `"5m"`, `"1h"`, `"1d"`.

### Examples

Heartbeat — wake the communicator each morning:

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

Maintenance workstream — run weekly on a cron:

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

## Actions

| `action` | Behavior |
|----------|----------|
| `communicator` | Sends a scheduled wake to the communicator (tagged `[schedule:<id>]`), not human chat |
| `workstream` | Starts a new workstream with the schedule body as the goal; title derived from `name` |

Scheduled fires use the same engine paths as normal work, so scheduler concurrency and quota limits apply unchanged.

---

## Runtime behavior

- **`every`:** due when `now >= lastFiredAt + interval`. On first start, waits **one full interval** before the first fire (avoids restart storms).
- **`cron`:** due when the current wall-clock minute matches a cron boundary in the schedule's timezone and `lastFiredAt` is before that boundary.
- **`enabled: false`:** schedule is ignored.
- **Overlap:** if a previous run for the same schedule is still in flight, the tick is **skipped** (not queued).
- **Missed ticks while down:** no backfill — the runtime waits for the next cron boundary or the next full interval after restart.

`lastFiredAt` and in-flight state live in the runtime data store (not git). Changing `every` or `cron` does not reset `lastFiredAt` unless the schedule id is removed and recreated.

---

## Human overrides via identity pull

Enable periodic pulls from origin so edits made on GitHub appear without redeploying:

```json
{
  "identity": {
    "pullInterval": "5m"
  }
}
```

When `pullInterval` is set, the runtime periodically `git pull --rebase`s the identity repo and reloads schedule definitions. Changes made on GitHub typically appear within about one pull interval when the working tree is clean.

On rebase conflict the pull is aborted and logged — schedules keep the last successfully loaded definitions until a human or the agent resolves the conflict.

See [Config Reference](./config.md#identity-block) for full `identity` options.

---

## Agent tools

The communicator (and any role allowed to write identity) can manage schedules:

| Tool | Effect |
|------|--------|
| `list_schedules` | List loaded schedules with next due, last fired, in-flight, and enabled state |
| `upsert_schedule` | Write or update `agent/schedules/<id>.md`, commit when auto-commit is on, reload runner |
| `set_schedule_enabled` | Pause or resume without deleting the file |
| `delete_schedule` | Remove the file, drop runtime state for that id, reload |
