# OpencodeExecutor — Design

**Date:** 2026-08-14
**Status:** Approved for planning
**Related:** [docs/research/2026-08-14-opencode-comparison.md](../../research/2026-08-14-opencode-comparison.md) (feasibility research), [docs/guides/custom-cli-executor.md](../../guides/custom-cli-executor.md), [docs/guides/qwen-code-executor.md](../../guides/qwen-code-executor.md)

## Purpose

Add the `opencode` CLI (installed locally at `/Users/danielbanks/.opencode/bin/opencode`, v1.17.3) as a first-class `WorkerExecutor` option, alongside the existing Claude Code and Cursor executors, so Artificer's `worker` role can delegate actual file-editing to opencode instead of Artificer's own internal LLM tool loop.

## Why not the generic `type: "cli"` executor

`docs/guides/custom-cli-executor.md` already supports "any CLI that speaks MCP" with zero new code, via a `type: "cli"` config. It doesn't fit opencode as-is because opencode's MCP config schema is genuinely different from the `mcpServers`/`{command, args}` shape every other supported CLI (Claude Code, Cursor, Qwen) uses:

- opencode reads MCP servers from a top-level `mcp` key in a project-level `opencode.json` (discovered by walking up from the process cwd), not a `mcpServers` key.
- Each server entry is `{"type": "local", "command": [...combined binary+args array...], "enabled": true}` — a single `command` array, not separate `command`/`args` fields.
- There is no `--mcp-config <path>` flag on `opencode run` — the config file location isn't parameterizable per-invocation, only discoverable by path convention.

`cli-executor.ts`'s MCP-config writer hardcodes the `mcpServers`/`{command,args}` shape, so it can't produce a file opencode will recognize. Rather than generalizing the shared `CliExecutor` to support pluggable MCP schemas (broader, riskier change, no other CLI currently needs it), this design adds a dedicated `OpencodeExecutor` class — the same choice already made for Claude Code and Cursor, both of which also have CLI-specific quirks (Claude Code: stdin prompt delivery; Cursor: fixed `--workspace` flag).

## Architecture

A new class, `OpencodeExecutor`, in `packages/runtime/src/engine/opencode-executor.ts`, implementing the existing `WorkerExecutor` interface (`packages/runtime/src/engine/executor.ts`) with the same overall shape as `ClaudeCodeExecutor` (`claude-code-executor.ts`) and `CursorAgentExecutor` (`cursor-executor.ts`):

```ts
export class OpencodeExecutor implements WorkerExecutor {
  readonly name = 'opencode';
  constructor(private readonly model?: string) {}
  execute({ context, workspaceDir }: { context: string; workspaceDir: string; run: RunRecord })
    : Promise<ExecutorResult> { ... }
}
```

### Invocation contract

1. Write `workspaceDir/opencode.json`:
   ```json
   {
     "mcp": {
       "artificer-status": {
         "type": "local",
         "command": ["<process.execPath>", "<path-to-mcp-status-server.mjs>", "<path-to-.artificer-status.json>"],
         "enabled": true
       }
     }
   }
   ```
2. Delete any stale `.artificer-status.json` in `workspaceDir`.
3. Spawn `opencode run "<context>" --dangerously-skip-permissions -m <model>` (model flag omitted if none configured) with `cwd: workspaceDir`. The prompt is delivered as a CLI positional argument (opencode's `run [message..]` signature), matching Cursor's pattern — not stdin, which is how Claude Code takes its prompt.
4. Buffer stdout/stderr. 10-minute timeout, SIGKILL on expiry, same as `ClaudeCodeExecutor`.
5. On process close:
   - Non-zero exit code → reject with an `Error` containing stderr (or stdout if stderr is empty), matching the existing convention.
   - Otherwise, attempt to read and parse `.artificer-status.json` exactly as the other two executors do — a `submit_review` payload becomes `ExecutorResult.review`; a `report_status` payload becomes `workerStatus`/`workerSummary`/`workerFollowUps`. Malformed/missing status file is silently ignored (falls back to raw stdout as `text`).
   - Resolve `ExecutorResult` with `text` = trimmed stdout, `usage: { inputTokens: 0, outputTokens: 0 }` (placeholder — matches existing executors; opencode doesn't surface usage on stdout by default in non-JSON format, and parsing `--format json` for usage is out of scope for this pass).

### Config wiring

- `packages/runtime/src/api/types.ts`: `ExecutorConfig` union gains `'opencode' | { type: 'opencode'; model?: string }`.
- `packages/runtime/src/engine/engine.ts`, `buildExecutor()`: add `if (config === 'opencode') return new OpencodeExecutor();` and `if (config.type === 'opencode') return new OpencodeExecutor(config.model);`, mirroring the existing Claude Code/Cursor branches.
- `packages/runtime/src/engine/provider-router.ts`, `executorForRoute()`: add the equivalent `route.executorName === 'opencode'` branch.

### Docs

New `docs/guides/opencode-executor.md`, modeled on `docs/guides/qwen-code-executor.md` — what it is, minimal `artificer.config.json` snippet, model options (the Zen `opencode/*` catalog), known limitations (no usage stats surfaced, requires local `opencode` auth already configured via `opencode providers`/`opencode auth`).

## Error handling

Identical to the existing two executors — no new error-handling patterns:
- Timeout → `SIGKILL` + reject.
- Non-zero exit → reject with stderr/stdout as the error message (this fails the run, surfaced through the normal workstream-failure path).
- Malformed or missing status file → ignored, `text` (raw stdout) is used as the fallback signal.
- `spawn` error (e.g. binary not found) → reject with the underlying error.

## Testing

No new unit tests for `OpencodeExecutor` itself — consistent with `ClaudeCodeExecutor`/`CursorAgentExecutor`, neither of which has unit tests, since they wrap real subprocess invocations of external binaries; the shared `mcp-status-server.mjs` already has its own test coverage (`mcp-status-server.test.ts`).

Validation is manual, in two phases, both performed once during implementation (not part of the automated test suite):

1. **Direct smoke test** — a throwaway script (not committed) that instantiates `OpencodeExecutor` directly against a plain scratch directory with a trivial task (e.g. "add a `titleCase(str)` function to `string-utils.ts` with a unit test"), confirming: `opencode.json` gets written correctly, `opencode run` actually invokes the MCP tool (`report_status` appears in `.artificer-status.json`), and the process exits cleanly (code 0).
2. **Real workstream** — one new small eval task fixture added under the existing `packages/eval` identity-eval / greenfield task conventions (see `packages/runtime/bench/tasks/greenfield/` for the existing pattern), run via `artificer eval run --task <id>` with the fixture's `artificer.config.json` executor set to `{"type": "opencode", "model": "opencode/gpt-5.4-mini"}`. This exercises the full planner → worker(opencode) → reviewer pipeline with automated grading, and needs no GitHub credentials (the eval harness runs against a local fixture repo).

## Explicitly out of scope for this pass

- Parsing `opencode run --format json`'s NDJSON event stream for richer progress/usage reporting — the MCP status-file protocol (already proven for Claude Code/Cursor) is sufficient for a first working version.
- Generalizing `CliExecutor` to support opencode's MCP schema as a configurable option — revisit only if a second CLI needs a non-`mcpServers`-shaped config.
- An in-process `@opencode-ai/sdk` integration (the "stronger option" flagged in the research doc) — subprocess + status-file is consistent with the existing executors and is the minimum needed to validate opencode as a worker.
