# Stop Workstream — Design Spec

**Date:** 2026-06-25

## Goal

Let a user stop a workstream that is stuck in a loop from the workstream detail page. Cancellation is soft: in-flight LLM runs complete naturally, but the FSM will not dispatch any new ones because `cancelled` is already a terminal status in `FSM_TERMINAL`.

## Scope

Four changes:
- `packages/runtime/src/engine/engine.ts` — add `cancelWorkstream(id)` method
- `packages/runtime/src/server/app.ts` — add `POST /api/workstreams/:id/cancel` route
- `apps/runtime-ui/src/api/hooks.ts` — add `useCancelWorkstream()` mutation
- `apps/runtime-ui/src/pages/WorkstreamDetailPage.tsx` — add Stop button

## Engine

```ts
async cancelWorkstream(id: string): Promise<boolean>
```

- Loads the workstream from the store
- Returns `false` if not found or if status is already in `FSM_TERMINAL` (`done`, `blocked`, `failed`, `cancelled`)
- Calls `store.updateWorkstream(id, { status: 'cancelled' })`
- Emits `{ kind: 'workstream', at: updatedAt, data: updatedWorkstream }`
- Returns `true`

## Server

`POST /api/workstreams/:id/cancel` (under the authenticated `/api` router):

- Calls `engine.cancelWorkstream(id)`
- Returns `404 { error: 'not found or already terminal' }` if `false`
- Returns `200 { ok: true }` if `true`

Follows the same pattern as the existing `POST /workstreams/:id/start`.

## UI hook

`useCancelWorkstream()` — `useMutation` that posts to `/workstreams/${id}/cancel`. On success, invalidates `['workstream', id]` and `['workstreams']`.

## UI

In `WorkstreamDetailPage`, add a "Stop workstream" `Button` (variant `outline`, color cue via red text) in the title row next to the `StatusBadge`. Visible only when `ws.status` is not in `['done', 'failed', 'cancelled']`. Shows a loading spinner while the mutation is in flight. No confirmation dialog — the button label is explicit.

## What Is Not Changing

- In-flight LLM runs are not aborted — they run to completion
- The workstream record is not deleted — status transitions to `cancelled`
- No UI on the workstreams list page — detail page only
