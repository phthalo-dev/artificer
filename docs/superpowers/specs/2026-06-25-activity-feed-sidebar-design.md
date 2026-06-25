# Activity Feed Sidebar — Design Spec

**Date:** 2026-06-25

## Goal

Add a collapsible right sidebar to the runtime-ui that shows a live stream of engine events — messages received, workstream status changes, run completions, and tool calls — so the user can see the agent is working even when the chat view feels quiet.

## Approach

Use the existing `/events` SSE endpoint (at the root origin, not under `/api`). A `useSSEEvents` hook opens a persistent `EventSource`, buffers up to 100 entries in local state, and the `ActivityFeed` component renders them in the `AppShell.Aside`. Display-only — no click navigation.

## Scope

Four changes:
- `src/api/client.ts` — export the SSE URL (`baseOrigin`)
- `src/api/hooks.ts` — add `useSSEEvents` hook
- `src/components/ActivityFeed.tsx` — new component
- `src/App.tsx` — wire aside, toggle button, feed

## `useSSEEvents` hook

Opens `EventSource` to `${baseOrigin}/events`. On each `message` event, parses the JSON data and prepends a formatted entry. On error, closes and reopens after 5 s (browser `EventSource` reconnects natively but we add a manual fallback).

Entry shape:
```ts
interface ActivityEntry {
  id: string;        // crypto.randomUUID()
  kind: 'message' | 'workstream' | 'run' | 'tool';
  label: string;
  at: string;        // ISO timestamp from event.at
}
```

Label formatting (matches terminal output):
| Event kind | Condition | Label |
|---|---|---|
| `message` | `data.direction === 'inbound'` | `→ message received` |
| `workstream` | always | `workstream:<status> "<title>"` |
| `run` | always | `run:<status> <role>` |
| `tool` | always | `tool <name>` |

Outbound messages are skipped (not logged). Buffer capped at 100 entries (slice oldest when exceeded).

## `ActivityFeed` component

Scrollable list in a `<ScrollArea>` with `flex: 1`. Newest entries at the **bottom** (append order, scroll-to-bottom on new entry via a `useEffect` + ref). Each row:
- A small colored dot by kind: blue=message, violet=workstream, orange=run, gray=tool
- The label text (`size="xs"`, monospace)
- A relative timestamp on the right (`size="xs"`, dimmed)

Empty state: dimmed "No activity yet" centered in the panel.

## App shell changes

`App.tsx`:
- `asideOpen` state, default `true`
- Toggle button in the header (`IconLayoutSidebarRightCollapse` / `IconLayoutSidebarRight`)
- `AppShell` gets `aside={{ width: 260, breakpoint: 'sm', collapsed: { mobile: true, desktop: !asideOpen } }}`
- `<AppShell.Aside p="sm">` contains a header row ("Activity" label + no extra controls) and `<ActivityFeed />`

## What Is Not Changing

- The existing polling hooks (`useRuntimeState`, `useMessages`, etc.) — left as-is; SSE is additive
- No click-through navigation from feed items
- No persistence across page refresh (in-memory buffer only)
- No verbose/filter toggle in the UI (all four event kinds always shown)
