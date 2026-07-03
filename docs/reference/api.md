# API Reference

The agent exposes an HTTP API for sending messages, reading state, and managing workstreams. All `/api/*` routes require `Authorization: Bearer <ARTIFICER_API_KEY>` when the key is set; when unset, authentication is disabled.

## Authentication

```
Authorization: Bearer <ARTIFICER_API_KEY>
```

The `GET /events` SSE endpoint also uses bearer auth (same key). Channel webhook endpoints (`/channels/*`) use their own platform-specific verification (Slack signing secret, Discord public key) and do NOT use the Artificer API key.

## Endpoints

### Messages

#### `POST /api/messages`

Send a message to the agent. The communicator role processes the message and may spawn workstreams.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | yes | Message text (minimum 1 character) |

**Response** — `202 Accepted`

```json
{ "message": { "id": "...", "direction": "inbound", "content": "...", "createdAt": "..." } }
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | Validation failure — `content` missing or empty |

---

#### `GET /api/messages`

List all messages (inbound and outbound).

**Response** — `200 OK`

```json
{ "messages": [ { "id": "...", "direction": "inbound" | "outbound", "content": "...", "createdAt": "..." } ] }
```

---

#### `GET /api/messages/:id/cost`

Cost breakdown for a specific message, including all runs that originated from it.

**Response** — `200 OK`

```json
{
  "message": { "id": "...", "direction": "...", "content": "...", "createdAt": "..." },
  "total": { "inputTokens": 0, "outputTokens": 0, "costDollars": 0 },
  "byWorkstream": { "<workstreamId>": { ... } },
  "byRole": { "<role>": { ... } },
  "tree": [ ... ]
}
```

**Error codes**

| Status | Condition |
|---|---|
| 404 | Message not found |

---

### State

#### `GET /api/state`

High-level runtime snapshot: agent name, queue depth, active runs, and workstream list.

**Response** — `200 OK`

```json
{
  "agentName": "my-agent",
  "busy": true,
  "queue": { "pending": 2, "running": 1 },
  "activeRuns": [
    { "runId": "...", "role": "worker", "workstreamId": "...", "startedAt": "..." }
  ],
  "workstreams": [
    { "id": "...", "title": "...", "status": "in_progress", "summary": "...", "updatedAt": "..." }
  ]
}
```

---

### Workstreams

#### `POST /api/workstreams`

Create a workstream directly, bypassing the communicator. Useful for structured intake (e.g., bench harness) where communicator variance should be removed.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Short workstream title |
| `goal` | string | yes | Full goal description |
| `repoUrl` | string | no | Git repository URL to clone into the workspace |
| `baseCommit` | string | no | Commit SHA to check out |
| `autostart` | boolean | no | When `false`, the orchestrator is not spawned immediately; call `POST /api/workstreams/:id/start` manually. Defaults to `true`. |

**Response** — `202 Accepted`

```json
{ "workstreamId": "...", "messageId": "..." }
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | Validation failure |

---

#### `GET /api/workstreams`

List all workstreams.

**Response** — `200 OK`

```json
{ "workstreams": [ { "id": "...", "title": "...", "status": "...", "goal": "...", "createdAt": "...", "updatedAt": "..." } ] }
```

---

#### `GET /api/workstreams/:id`

Full workstream detail including tasks, reviews, plan, runs, usage summary, and call tree.

**Response** — `200 OK`

```json
{
  "workstream": { "id": "...", "title": "...", "status": "...", "goal": "...", "createdAt": "...", "updatedAt": "..." },
  "tasks": [ ... ],
  "reviews": [ ... ],
  "plan": "...",
  "runs": [ ... ],
  "usage": {
    "total": { "inputTokens": 0, "outputTokens": 0, "costDollars": 0 },
    "byTask": { "<taskId>": { ... } },
    "byRole": { "<role>": { ... } }
  },
  "tree": [ ... ]
}
```

**Error codes**

| Status | Condition |
|---|---|
| 404 | Workstream not found |

---

#### `POST /api/workstreams/:id/start`

Kick off a workstream that was created with `autostart: false`. Spawns the orchestrator.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `messageId` | string | yes | The message ID returned by `POST /api/workstreams` |

**Response** — `202 Accepted`

```json
{ "ok": true }
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | Validation failure |
| 404 | Workstream not found |

---

#### `POST /api/workstreams/:id/cancel`

Cancel an active workstream. No-op if the workstream is already in a terminal state.

**Request body** — none

**Response** — `200 OK`

```json
{ "ok": true }
```

**Error codes**

| Status | Condition |
|---|---|
| 404 | Workstream not found or already in a terminal state |

---

### Memories

Requires an identity store to be configured. All memory routes return `503` when no identity store is available.

#### `GET /api/memories`

List all memories. Pass `?q=<text>` to run a semantic search (returns up to 20 results).

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Optional search query |

**Response** — `200 OK`

```json
{ "memories": [ { "id": "...", "content": "...", "title": "...", "kind": "note", "tags": [], "createdAt": "..." } ] }
```

When no `q` is provided the list is sorted newest-first. When `q` is provided the list is ordered by relevance.

---

#### `POST /api/memories`

Create a memory.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | yes | Memory text (minimum 1 character) |
| `title` | string | no | Short title |
| `summary` | string | no | Brief summary |
| `tags` | string[] | no | Array of tag strings |
| `source` | string | no | Origin identifier (e.g., workstream ID) |
| `kind` | string | no | One of `note`, `document`, `preference` |

**Response** — `201 Created`

```json
{ "memory": { "id": "...", "content": "...", "title": "...", "kind": "note", "tags": [], "createdAt": "..." } }
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | Validation failure |
| 503 | Identity store not configured |

---

#### `DELETE /api/memories/:id`

Delete a memory by ID.

**Response** — `200 OK`

```json
{ "ok": true }
```

**Error codes**

| Status | Condition |
|---|---|
| 404 | Memory not found |
| 503 | Identity store not configured |

---

### Usage and cost

#### `GET /api/usage`

Full usage breakdown across all runs.

**Response** — `200 OK`

```json
{
  "total": { "inputTokens": 0, "outputTokens": 0, "costDollars": 0 },
  "byRole": { "<role>": { ... } },
  "byModel": { "<modelId>": { ... } },
  "byRoute": { "<routeProfileId>": { ... } },
  "byWorkstream": { "<workstreamId>": { ... } },
  "byMessage": [
    {
      "messageId": "...",
      "createdAt": "...",
      "content": "first 140 chars…",
      "usage": { "inputTokens": 0, "outputTokens": 0, "costDollars": 0 }
    }
  ],
  "quota": null
}
```

The `quota` field is `null` when quota is not configured; otherwise it contains the current quota ledger snapshot.

---

#### `POST /api/quota/reset`

Reset a quota window, which unpauses any workstreams that were blocked by it.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `accountId` | string | yes | Quota account ID |
| `windowId` | string | yes | Window ID within the account |
| `workstreamId` | string | no | When provided, resets only the per-workstream window |

**Response** — `200 OK`

```json
{ "ok": true, "quota": { ... } }
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | `accountId` or `windowId` missing |
| 404 | Window not found |

---

### Configuration

#### `GET /api/config/models`

Current model tier assignments, per-role tier overrides, active preset, available presets, and the full model catalog.

**Response** — `200 OK`

```json
{
  "tiers": { "low": "...", "medium": "...", "high": "..." },
  "roleTiers": { "communicator": "medium", "orchestrator": "high", ... },
  "activePresetId": "claude-sonnet",
  "presets": [
    { "id": "...", "name": "...", "description": "...", "tiers": { ... }, "roleTiers": { ... } }
  ],
  "catalog": [
    { "id": "...", "provider": "Anthropic", "pricing": { ... } }
  ]
}
```

---

#### `PUT /api/config/models`

Update one or more model tier assignments. Unspecified tiers are left unchanged. Sets the active preset to `custom`.

**Request body** — at least one field required

| Field | Type | Required | Description |
|---|---|---|---|
| `low` | string | no | Model ID for the low-complexity tier |
| `medium` | string | no | Model ID for the medium-complexity tier |
| `high` | string | no | Model ID for the high-complexity tier |

**Response** — `200 OK`

```json
{
  "tiers": { "low": "...", "medium": "...", "high": "..." },
  "roleTiers": { ... },
  "activePresetId": "custom"
}
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | No tier fields provided, or validation failure |

---

#### `PUT /api/config/role-tiers`

Update per-role model tier overrides. Only the listed roles are updated.

**Request body** — a JSON object mapping role names to tier names

Valid role names: `communicator`, `orchestrator`, `planner`, `reviewer`, `worker`, `librarian`

Valid tier values: `low`, `medium`, `high`

```json
{ "worker": "high", "reviewer": "medium" }
```

**Response** — `200 OK`

```json
{
  "tiers": { "low": "...", "medium": "...", "high": "..." },
  "roleTiers": { "communicator": "medium", "worker": "high", ... },
  "activePresetId": "custom"
}
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | Invalid role or tier value |

---

#### `PUT /api/config/preset`

Apply a named model preset. Sets both tier model IDs and per-role tier overrides to the preset's values.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `presetId` | string | yes | Preset ID from `GET /api/config/models` |

**Response** — `200 OK`

```json
{
  "presetId": "claude-sonnet",
  "name": "Claude Sonnet",
  "tiers": { "low": "...", "medium": "...", "high": "..." },
  "roleTiers": { ... },
  "activePresetId": "claude-sonnet"
}
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | Unknown preset ID or validation failure |

---

#### `GET /api/config/quota`

Current quota configuration (configured and effective), primary account ID, model catalog, and available presets.

**Response** — `200 OK`

```json
{
  "configured": null,
  "effective": null,
  "primaryAccountId": "...",
  "catalog": [ ... ],
  "presets": [ ... ]
}
```

`configured` is the quota as written in config; `effective` is after auto-detection and environment overrides. Both are `null` when quota is not configured.

---

#### `PUT /api/config/quota`

Replace the quota configuration. Takes effect immediately for subsequent runs.

**Request body**

The body must include either `routes` or legacy `accounts` (at least one). The `routes` form is preferred.

| Field | Type | Required | Description |
|---|---|---|---|
| `reservePercent` | number (0–50) | no | Percentage of each window to hold in reserve |
| `defaultEstimateDollars` | object | no | Per-tier cost estimate used when metered billing is unavailable |
| `routes` | array | no* | Execution routes (preferred form) |
| `accounts` | array | no* | Legacy account objects |

*At least one of `routes` or `accounts` is required.

Each route object (`routes[]`):

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Route identifier |
| `accountId` | string | yes | Account identifier |
| `mode` | string | yes | `metered`, `windowed`, or `opaque` |
| `windows` | array | yes | One or more quota window objects (see below) |
| `execution` | string | yes | `llm`, `cursor-agent`, or `claude-code` |
| `llm` | object | no | `{ baseURL, apiKeyEnv }` for custom LLM endpoints |
| `presetId` | string | no | Model preset to use for this route |
| `models` | object | yes | `{ low, medium, high }` model IDs |
| `roleTiers` | object | no | Per-role tier overrides for this route |
| `roles` | string[] | no | Restrict route to specific roles |
| `pollIntervalMs` | number | no | How often to poll quota state (milliseconds) |

Each quota window object (`windows[]`):

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Window identifier |
| `unit` | string | yes | `dollars`, `tokens`, or `requests` |
| `period` | string | yes | `rolling5h`, `daily`, `weekly`, `monthly`, or `fixed` |
| `scope` | string | no | `global` or `workstream` |
| `limit` | number | yes | Budget limit (positive number) |
| `warnAtPercent` | number (0–100) | no | Emit a warning event at this utilization percentage |
| `blockAtPercent` | number (0–100) | no | Block new work at this utilization percentage |

**Response** — `200 OK`

```json
{
  "configured": { ... },
  "effective": { ... },
  "primaryAccountId": "...",
  "quota": { ... }
}
```

**Error codes**

| Status | Condition |
|---|---|
| 400 | Validation failure or invalid configuration |

---

### Health

#### `GET /api/health`

Liveness check.

**Response** — `200 OK`

```json
{ "ok": true, "agent": "my-agent" }
```

---

### Bench (internal)

These routes expose benchmark run data. They are intended for the bench harness and the UI, not for general use.

#### `GET /api/bench/runs`

Overview of all benchmark runs. Returns `404` when no benchmark results exist (run `pnpm bench` first).

#### `GET /api/bench/suites`

List available benchmark suites.

#### `GET /api/bench/runs/:instanceId`

Detail for a specific benchmark run instance.

---

### GitHub watch (internal)

#### `POST /api/github/watch`

Trigger one GitHub watch cycle manually. Returns `400` when GitHub is not configured (no `GITHUB_TOKEN`).

---

## SSE events

`GET /events` streams Server-Sent Events. Connect with:

```
GET /events
Authorization: Bearer <ARTIFICER_API_KEY>
Accept: text/event-stream
```

Each event has the form:

```
event: <kind>
data: <JSON>
```

A `ping` event is sent every 15 seconds to keep the connection alive:

```
event: ping
data: 1719878400000
```

The `data` field for a ping is the current Unix timestamp in milliseconds (as a plain number, not JSON).

### Event types

#### `message`

Emitted when an inbound or outbound message is recorded.

```json
{ "kind": "message", "at": "<ISO timestamp>", "data": { <Message object> } }
```

Fired on: `POST /api/messages` (inbound), and whenever the agent sends a reply (outbound).

---

#### `workstream`

Emitted when a workstream is created or its status changes.

```json
{ "kind": "workstream", "at": "<ISO timestamp>", "data": { <Workstream object> } }
```

Fired on: workstream creation, status transitions (e.g., `pending` → `planning` → `in_progress` → `reviewing` → `done`), cancellation, and quota pausing.

---

#### `run`

Emitted when a run starts and when it finishes (succeeded or failed).

```json
{ "kind": "run", "at": "<ISO timestamp>", "data": { <RunRecord object> } }
```

The `data` object includes `role`, `status`, `model`, `workstreamId`, `taskId`, `inputTokens`, `outputTokens`, and related fields.

---

#### `tool`

Emitted each time a tool is invoked during a run.

```json
{
  "kind": "tool",
  "at": "<ISO timestamp>",
  "data": {
    "runId": "...",
    "name": "...",
    "input": { ... },
    "output": "...",
    "error": "..."
  }
}
```

---

#### `quota`

Emitted on quota state changes.

```json
{ "kind": "quota", "at": "<ISO timestamp>", "data": { "event": "exhausted" | "resumed" | "failover_cleared", "resumesAt": "..." } }
```

| `event` value | Meaning |
|---|---|
| `exhausted` | Quota limit reached; workstreams are paused. `resumesAt` is an ISO timestamp when the window resets, or absent if unknown. |
| `resumed` | Quota window reset; paused workstreams are resuming. |
| `failover_cleared` | A failover route's exhaustion window cleared; primary route is active again. Includes `accountId`. |

---

## Response format

All responses are JSON. Error responses follow one of two shapes:

```json
{ "error": "<message>" }
```

```json
{ "error": { "formErrors": [], "fieldErrors": { "<field>": ["<message>"] } } }
```

The nested form is used for Zod validation errors (invalid request bodies). The flat string form is used for all other errors.
