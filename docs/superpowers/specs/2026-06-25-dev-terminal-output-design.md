# Dev Terminal Output — Design Spec

**Date:** 2026-06-25

## Goal

When a developer runs `artificer dev`, the terminal should show:
1. A clear startup block listing all relevant URLs and directories
2. A live event log showing high-level activity as it happens, with verbose tool logging available via an env var

## Scope

Two files change:
- `packages/runtime/src/api/create-runtime.ts` — improve the startup log block in `start()`
- `packages/cli/src/commands/dev.ts` — subscribe to engine events and print them

No changes to the engine, server, types, or `start.ts` (production command).

## Startup Output

Replace the current 3-line log in `create-runtime.ts`'s `start()` callback with a formatted block:

```
[artificer] my-agent ready

  API   http://localhost:4100/api
  UI    http://localhost:4100
  SSE   http://localhost:4100/events

  identity  /path/to/agent
  data      /path/to/.artificer
```

The port comes from `info.port` (the actual bound port, same as today). The agent name comes from `config.agentName`.

## Event Logging

After `await runtime.start()` in `dev.ts`, call `runtime.engine.subscribe()` and write events to stdout.

### Default output (all events except `tool`)

| Event kind | Condition | Output |
|---|---|---|
| `message` | `data.direction === 'inbound'` | `[artificer] → message received` |
| `workstream` | always | `[artificer] workstream:<status> "<title>"` |
| `run` | always | `[artificer] run:<status> <role>` |

The `data` field on each event is typed as `unknown` in `RuntimeEvent`. Cast to access `direction`, `status`, `title`, `role` — these are the shapes already persisted to the store.

### Verbose mode (`ARTIFICER_VERBOSE=true`)

When `process.env.ARTIFICER_VERBOSE === 'true'`, also log `tool` events:

```
[artificer] tool <name>
```

Tool events are silenced by default to keep the output readable under normal workload.

## What Is Not Changing

- `start.ts` (production command) — no event logging added there
- The engine's `subscribe()` / `emit()` surface — unchanged
- The `ArtificerRuntime` type — `engine` is already a public field, no type changes needed
- Formatting library — plain `console.log` only, no chalk or boxen dependency
