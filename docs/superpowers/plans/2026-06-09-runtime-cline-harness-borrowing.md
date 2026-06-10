# Runtime Cline Harness Borrowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt high-ROI patterns from the Cline SDK harness — within-call context hygiene, safety rails, bench completion semantics, deterministic testing, and optional human-in-the-loop / MCP / checkpoint infrastructure — without replacing Artificer's phase-based FSM.

**Architecture:** Extend the existing `runToolLoop` (`llm/loop.ts`) using AI SDK v6 `prepareStep` / `onStepFinish` hooks so we can mutate messages between tool-use steps without abandoning `generateText` + `stopWhen`. New pure modules (`message-sanitizer`, `loop-detection`, `mistake-tracker`, `request-diagnostics`) live under `src/llm/`. Shell, completion, VCR, MCP, and checkpoint work are separate packages of change wired through config flags so bench runs stay autonomous by default.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥21, AI SDK v6 (`generateText`, `prepareStep`, `onStepFinish`), `node:test`, existing bench harness (`packages/runtime/bench`).

**Inspiration source:** Cline SDK at `../cline/sdk/` — especially `@cline/core` context pipeline, safety trackers, tool policies, VCR, and eval pyramid.

**Prerequisite context:** Artificer already has between-call microcompact, tool-result spill, file-cache hints, and output elision (see `docs/superpowers/plans/2026-06-01-runtime-claude-code-borrowing.md`). This plan fills the **within-call** and **harness-quality** gaps identified in the Cline comparison.

---

## Phases overview

| Phase | Focus | Est. effort | Depends on |
|-------|-------|-------------|------------|
| **0** | Config + `prepareStep` hook infrastructure | 0.5 day | — |
| **1** | Within-call context + safety (quick wins) | 2–3 days | Phase 0 |
| **2** | Shell hardening + bench completion semantics | 2 days | Phase 0 |
| **3** | VCR + L1/L2 eval pyramid | 2–3 days | Phase 1 |
| **4** | MCP integration | 3–5 days | Phase 0 |
| **5** | Tool approval policy (human-in-the-loop) | 2 days | Phase 0 |
| **6** | Git checkpoints | 2 days | Phase 2 |

Phases 4–6 are **strategic** — implement only when product direction requires IDE integration or user-present operation. Phases 0–3 deliver bench ROI immediately.

---

## File structure (all phases)

### Phase 0 — create
- `packages/runtime/src/llm/call-safety-config.ts` — types + defaults for within-call safety
- `packages/runtime/src/llm/step-hooks.ts` — `prepareStep` / `onStepFinish` orchestration

### Phase 1 — create
- `packages/runtime/src/llm/message-sanitizer.ts` — outdated read invalidation, tool-result caps
- `packages/runtime/src/llm/message-sanitizer.test.ts`
- `packages/runtime/src/llm/loop-detection.ts` — repeated tool-call detection (Cline port)
- `packages/runtime/src/llm/loop-detection.test.ts`
- `packages/runtime/src/llm/mistake-tracker.ts` — consecutive failure counter
- `packages/runtime/src/llm/mistake-tracker.test.ts`
- `packages/runtime/src/llm/request-diagnostics.ts` — per-step size logging
- `packages/runtime/src/llm/request-diagnostics.test.ts`

### Phase 1 — modify
- `packages/runtime/src/config.ts` — `CallSafetyConfig`, `WithinCallContextConfig`
- `packages/runtime/src/llm/loop.ts` — wire hooks, loop gate in tool execute
- `packages/runtime/src/llm/types.ts` — extend `RunToolLoopOptions`
- `packages/runtime/src/engine/call.ts` — pass safety config into loop
- `packages/runtime/.env.example`
- `packages/runtime/bench/README.md`

### Phase 2 — create
- `packages/runtime/src/tools/shell-spawn.ts` — process-group spawn + tree kill
- `packages/runtime/src/tools/shell-spawn.test.ts`
- `packages/runtime/src/tools/declare-done.ts` — bench completion tool
- `packages/runtime/src/tools/declare-done.test.ts`
- `packages/runtime/src/engine/patch-facts.ts` — git-diff-based `patchPresent`

### Phase 2 — modify
- `packages/runtime/src/tools/shell.ts` — use `shell-spawn` on Unix
- `packages/runtime/src/tools/registry.ts` — register `declare_done` in single-loop worker set
- `packages/runtime/src/engine/single-loop.ts` — completion-tool prompt guidance
- `packages/runtime/src/engine/engine.ts` — `patchPresent` via `patch-facts.ts`
- `packages/runtime/src/engine/workstream-machine.ts` — single-loop done requires `declare_done`

### Phase 3 — create
- `packages/runtime/src/llm/vcr.ts` — fetch record/playback (Cline-inspired, slimmed)
- `packages/runtime/src/llm/vcr.test.ts`
- `packages/runtime/src/llm/loop.integration.test.ts` — VCR-backed call-path test
- `packages/runtime/bench/smoke/scenarios.json` — 5 short scenarios
- `packages/runtime/bench/smoke/run-smoke.sh` — L2 smoke driver

### Phase 3 — modify
- `packages/runtime/package.json` — `test:smoke`, `test:integration` scripts
- `packages/runtime/bench/README.md` — eval pyramid section

### Phase 4 — create
- `packages/runtime/src/mcp/manager.ts`
- `packages/runtime/src/mcp/config-loader.ts`
- `packages/runtime/src/mcp/tools.ts` — MCP → `ToolDef` adapter
- `packages/runtime/src/mcp/manager.test.ts`

### Phase 4 — modify
- `packages/runtime/src/config.ts` — `mcpServersPath`
- `packages/runtime/src/tools/registry.ts` — merge MCP tools when configured
- `packages/runtime/.env.example`

### Phase 5 — create
- `packages/runtime/src/tools/tool-policy.ts` — per-tool + global `*` merge
- `packages/runtime/src/tools/tool-policy.test.ts`
- `packages/runtime/src/tools/tool-approval.ts` — in-process approval callback

### Phase 5 — modify
- `packages/runtime/src/config.ts` — `ToolPolicyConfig`
- `packages/runtime/src/llm/loop.ts` — approval gate before tool execute
- `packages/runtime/src/server/` — optional HTTP approval endpoint (if exposing runtime to UI)

### Phase 6 — create
- `packages/runtime/src/engine/checkpoint.ts` — git stash per workstream turn
- `packages/runtime/src/engine/checkpoint-restore.ts`
- `packages/runtime/src/engine/checkpoint.test.ts`

### Phase 6 — modify
- `packages/runtime/src/engine/engine.ts` — `afterRun` checkpoint hook
- `packages/runtime/src/storage/types.ts` — checkpoint metadata on workstream

---

## Phase 0 — Hook infrastructure

### Task 0.1: Config types for within-call safety

**Files:**
- Create: `packages/runtime/src/llm/call-safety-config.ts`
- Modify: `packages/runtime/src/config.ts`
- Modify: `packages/runtime/.env.example`

- [ ] **Step 1: Add types**

```ts
// packages/runtime/src/llm/call-safety-config.ts
export interface LoopDetectionConfig {
  softThreshold: number;   // inject warning user message
  hardThreshold: number; // abort call
}

export interface MistakeTrackerConfig {
  maxConsecutiveMistakes: number;
}

export interface WithinCallContextConfig {
  maxToolResultChars: number;      // per result in message sanitizer (default 50_000)
  maxTotalTextChars: number;       // total chars across messages before step (default 500_000)
  outdatedReadInvalidation: boolean;
}

export interface CallSafetyConfig {
  loopDetection: LoopDetectionConfig;
  mistakeTracker: MistakeTrackerConfig;
  withinCallContext: WithinCallContextConfig;
  requestDiagnostics: boolean;
}

export const DEFAULT_CALL_SAFETY: CallSafetyConfig = {
  loopDetection: { softThreshold: 3, hardThreshold: 6 },
  mistakeTracker: { maxConsecutiveMistakes: 4 },
  withinCallContext: {
    maxToolResultChars: 50_000,
    maxTotalTextChars: 500_000,
    outdatedReadInvalidation: true,
  },
  requestDiagnostics: false,
};
```

- [ ] **Step 2: Wire into `RuntimeConfig`**

Add `callSafety: CallSafetyConfig` to `RuntimeConfig` in `config.ts`. Load from env:

```
RUNTIME_LOOP_SOFT_THRESHOLD=3
RUNTIME_LOOP_HARD_THRESHOLD=6
RUNTIME_MISTAKE_MAX=4
RUNTIME_WITHIN_CALL_MAX_TOOL_RESULT_CHARS=50000
RUNTIME_WITHIN_CALL_MAX_TOTAL_CHARS=500000
RUNTIME_OUTDATED_READ_INVALIDATION=true
RUNTIME_REQUEST_DIAGNOSTICS=false
```

- [ ] **Step 3: Run type-check**

```bash
cd packages/runtime && pnpm type-check
```

Expected: PASS

---

### Task 0.2: Step hook orchestrator

**Files:**
- Create: `packages/runtime/src/llm/step-hooks.ts`
- Modify: `packages/runtime/src/llm/loop.ts`
- Modify: `packages/runtime/src/llm/types.ts`

- [ ] **Step 1: Define hook context**

```ts
// packages/runtime/src/llm/step-hooks.ts
import type { ModelMessage } from 'ai';
import type { StepResult } from 'ai';
import type { CallSafetyConfig } from './call-safety-config.js';
import type { LoopDetectionState } from './loop-detection.js';
import type { MistakeTrackerState } from './mistake-tracker.js';

export interface StepHookContext {
  safety: CallSafetyConfig;
  loopState: LoopDetectionState;
  mistakeState: MistakeTrackerState;
  runId: string;
  log?: (line: string) => void;
}

export interface PrepareStepOutcome {
  messages: ModelMessage[];
  abortReason?: string;
}

export function createStepHookContext(safety: CallSafetyConfig, runId: string): StepHookContext {
  return {
    safety,
    loopState: createLoopDetectionState(),
    mistakeState: createMistakeTrackerState(),
    runId,
  };
}
```

Import `createLoopDetectionState` / `createMistakeTrackerState` from modules created in Phase 1 — for Task 0.2, stub them as no-op factories returning empty state objects, then replace in Task 1.

- [ ] **Step 2: Extend `RunToolLoopOptions`**

```ts
// packages/runtime/src/llm/types.ts (or loop.ts if types live there)
import type { CallSafetyConfig } from './call-safety-config.js';

export interface RunToolLoopOptions {
  // ...existing fields...
  callSafety?: CallSafetyConfig;
  onDiagnostics?: (summary: RequestDiagnosticsSummary) => void;
}
```

- [ ] **Step 3: Wire `prepareStep` and `onStepFinish` in `runToolLoop`**

```ts
// packages/runtime/src/llm/loop.ts — inside generateText call
const hookCtx = createStepHookContext(opts.callSafety ?? DEFAULT_CALL_SAFETY, opts.toolResultSpill?.runId ?? 'unknown');

const result = await generateText({
  model,
  system,
  messages,
  tools: tools.length > 0 ? sdkTools : undefined,
  maxOutputTokens: maxTokens,
  stopWhen: stepCountIs(maxIterations),
  prepareStep: async ({ messages: stepMessages, stepNumber, steps }) => {
    const outcome = await runPrepareStep(hookCtx, stepMessages, stepNumber, steps);
    if (outcome.abortReason) {
      throw new CallAbortedError(outcome.abortReason);
    }
    return { messages: outcome.messages };
  },
  onStepFinish: async (event) => {
    runOnStepFinish(hookCtx, event, opts.onDiagnostics);
  },
});
```

Add `CallAbortedError` in `packages/runtime/src/llm/errors.ts`; `call.ts` already uses `formatCallError` — map abort to a failed run with readable reason.

- [ ] **Step 4: Pass config from `call.ts`**

```ts
// packages/runtime/src/engine/call.ts — in executeCall runToolLoop invocation
callSafety: config.callSafety,
onDiagnostics: config.callSafety.requestDiagnostics
  ? (s) => console.info(`[run ${run.id}] ${JSON.stringify(s)}`)
  : undefined,
```

- [ ] **Step 5: Run tests**

```bash
cd packages/runtime && pnpm test && pnpm type-check
```

Expected: PASS (existing tests unaffected; stubs are no-ops)

---

## Phase 1 — Within-call context + safety

### Task 1.1: Outdated read invalidation

**Files:**
- Create: `packages/runtime/src/llm/message-sanitizer.ts`
- Create: `packages/runtime/src/llm/message-sanitizer.test.ts`
- Modify: `packages/runtime/src/llm/step-hooks.ts`

**Reference:** Cline `MessageBuilder` at `../cline/sdk/packages/core/src/session/services/message-builder.ts` — `OUTDATED_FILE_CONTENT` pattern.

- [ ] **Step 1: Failing test**

```ts
// message-sanitizer.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidateOutdatedReads } from './message-sanitizer.js';

test('earlier read_file result replaced when same path re-read later', () => {
  const messages = [
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'a1', toolName: 'read_file', input: { path: 'src/foo.ts' } }],
    },
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'a1', toolName: 'read_file', output: { type: 'text', value: 'old content' } }],
    },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'a2', toolName: 'read_file', input: { path: 'src/foo.ts' } }],
    },
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'a2', toolName: 'read_file', output: { type: 'text', value: 'new content' } }],
    },
  ] as const;

  const out = invalidateOutdatedReads(messages as any);
  const first = out[1].content[0];
  assert.match(String((first as any).output?.value ?? first), /outdated/i);
  const second = out[3].content[0];
  assert.match(String((second as any).output?.value ?? second), /new content/);
});
```

Adapt message shape to match AI SDK `ModelMessage` tool-result blocks used in your provider path — inspect `result.steps` from an existing run fixture if needed.

- [ ] **Step 2: Implement `invalidateOutdatedReads`**

Algorithm (mirror Cline):
1. Walk messages in order; for each `read_file` tool-call, record `toolCallId → path`.
2. Track `latestReadByPath: Map<string, toolCallId>`.
3. On second read of same path, mark earlier `toolCallId` as outdated.
4. Rewrite outdated tool-result text to `[outdated - see the latest file content]`.

Also export `truncateToolResults(messages, maxChars)` for per-result cap.

- [ ] **Step 3: Wire into `runPrepareStep`**

```ts
export async function runPrepareStep(ctx, messages, stepNumber, steps): Promise<PrepareStepOutcome> {
  let next = messages;
  if (ctx.safety.withinCallContext.outdatedReadInvalidation) {
    next = invalidateOutdatedReads(next);
  }
  next = truncateToolResults(next, ctx.safety.withinCallContext.maxToolResultChars);
  next = enforceTotalTextBudget(next, ctx.safety.withinCallContext.maxTotalTextChars);
  return { messages: next };
}
```

- [ ] **Step 4: Run test**

```bash
cd packages/runtime && node --import tsx --test src/llm/message-sanitizer.test.ts
```

Expected: PASS

---

### Task 1.2: Within-call loop detection

**Files:**
- Create: `packages/runtime/src/llm/loop-detection.ts`
- Create: `packages/runtime/src/llm/loop-detection.test.ts`
- Modify: `packages/runtime/src/llm/loop.ts` (tool execute wrapper)
- Modify: `packages/runtime/src/llm/step-hooks.ts`

**Reference:** `../cline/sdk/packages/core/src/runtime/safety/loop-detection.ts`

- [ ] **Step 1: Port pure helpers**

```ts
export interface LoopDetectionState {
  lastToolName: string;
  lastToolSignature: string;
  consecutiveIdenticalCount: number;
}

export function toolCallSignature(input: unknown): string { /* sorted JSON */ }
export function checkRepeatedToolCall(state, toolName, signature, config): {
  softWarning: boolean;
  hardEscalation: boolean;
}
```

- [ ] **Step 2: Failing tests** — 2 identical calls → soft at 3, hard at 6.

- [ ] **Step 3: Gate in tool execute (before handler)**

In `loop.ts` tool `execute`:

```ts
const sig = toolCallSignature(args);
const check = checkRepeatedToolCall(hookCtx.loopState, def.name, sig, hookCtx.safety.loopDetection);
if (check.hardEscalation) {
  return 'Error: Repeated identical tool call detected. Try a different approach.';
}
if (check.softWarning) {
  // Still execute, but prepareStep will inject a user message — set a flag on hookCtx
  hookCtx.pendingLoopWarning = LOOP_WARNING_TEXT;
}
```

- [ ] **Step 4: Inject soft warning in `prepareStep`**

If `hookCtx.pendingLoopWarning` is set, append `{ role: 'user', content: warning }` to messages, then clear flag.

- [ ] **Step 5: Hard escalation aborts call** — `prepareStep` checks mistake/loop hard flags and returns `abortReason`.

---

### Task 1.3: Mistake tracker

**Files:**
- Create: `packages/runtime/src/llm/mistake-tracker.ts`
- Create: `packages/runtime/src/llm/mistake-tracker.test.ts`
- Modify: `packages/runtime/src/llm/step-hooks.ts`

**Reference:** `../cline/sdk/packages/core/src/runtime/safety/mistake-tracker.ts`

- [ ] **Step 1: Implement tracker**

```ts
export interface MistakeTrackerState {
  consecutiveMistakes: number;
}

export type StepOutcome = 'productive' | 'all_tools_failed' | 'api_error' | 'invalid_tool_calls';

export function recordStepOutcome(state: MistakeTrackerState, outcome: StepOutcome, max: number): {
  shouldAbort: boolean;
}
```

Rules:
- `productive` → reset counter to 0
- `all_tools_failed` / `api_error` → increment
- At `max` → `shouldAbort: true`

- [ ] **Step 2: Classify step in `onStepFinish`**

Inspect `event.toolResults` / `event.toolCalls` from AI SDK `OnStepFinishEvent`:
- All tool results start with `Error:` → `all_tools_failed`
- `event.finishReason === 'error'` → `api_error`
- Otherwise → `productive`

- [ ] **Step 3: Abort call when limit hit** — set `hookCtx.abortReason`; next `prepareStep` throws `CallAbortedError`.

---

### Task 1.4: Request diagnostics

**Files:**
- Create: `packages/runtime/src/llm/request-diagnostics.ts`
- Create: `packages/runtime/src/llm/request-diagnostics.test.ts`
- Modify: `packages/runtime/src/llm/step-hooks.ts`

- [ ] **Step 1: Implement `summarizeStepRequest(messages, system)`**

Return:

```ts
export interface RequestDiagnosticsSummary {
  stepNumber: number;
  estimatedTokens: number;  // ceil(chars / 3) — match Cline conservative estimator
  systemChars: number;
  messageChars: number;
  toolResultChars: number;
  largestToolResults: Array<{ toolName: string; chars: number }>;
}
```

- [ ] **Step 2: Call from `onStepFinish`** when `ctx.safety.requestDiagnostics` is true; forward to `opts.onDiagnostics`.

- [ ] **Step 3: Bench integration** — document `RUNTIME_REQUEST_DIAGNOSTICS=true` in `bench/README.md` for debugging context blowups.

---

### Task 1.5: Phase 1 integration test

- [ ] **Step 1: Add `packages/runtime/src/llm/step-hooks.integration.test.ts`**

Pure integration without LLM: feed synthetic `ModelMessage[]` through `runPrepareStep` twice simulating re-read; assert outdated marker appears.

- [ ] **Step 2: Run full suite**

```bash
cd packages/runtime && pnpm test && pnpm type-check
```

Expected: PASS

- [ ] **Step 3: Commit** (when user requests)

```bash
git add packages/runtime/src/llm/ packages/runtime/src/config.ts packages/runtime/.env.example
git commit -m "feat(runtime): within-call context hygiene and safety rails"
```

---

## Phase 2 — Shell hardening + bench completion

### Task 2.1: Process-tree kill for `run_shell`

**Files:**
- Create: `packages/runtime/src/tools/shell-spawn.ts`
- Create: `packages/runtime/src/tools/shell-spawn.test.ts`
- Modify: `packages/runtime/src/tools/shell.ts`

**Reference:** `../cline/sdk/packages/core/src/extensions/tools/executors/bash.ts`

- [ ] **Step 1: Failing test** — mock spawn; on timeout, verify `kill(-pid, 'SIGKILL')` called on Unix.

- [ ] **Step 2: Implement `runShellCommandSpawn`**

```ts
import { spawn } from 'node:child_process';

export async function runShellCommandSpawn(opts: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<ShellRunResult> {
  // Unix: spawn('bash', ['-lc', command], { detached: true, ... })
  // On timeout: process.kill(-pid, 'SIGKILL')
  // Windows: spawn('cmd', ['/c', command]) + taskkill /T /F
}
```

- [ ] **Step 3: Feature flag in config**

```ts
// config.ts
shellUseProcessGroup: boolean; // RUNTIME_SHELL_PROCESS_GROUP=true (default true on Unix)
```

- [ ] **Step 4: `shell.ts` uses spawn path when flag true; keep `exec` fallback for Windows dev without flag.

- [ ] **Step 5: Run tests**

```bash
cd packages/runtime && node --import tsx --test src/tools/shell-spawn.test.ts
```

---

### Task 2.2: `declare_done` completion tool

**Files:**
- Create: `packages/runtime/src/tools/declare-done.ts`
- Create: `packages/runtime/src/tools/declare-done.test.ts`
- Modify: `packages/runtime/src/tools/registry.ts`
- Modify: `packages/runtime/src/engine/single-loop.ts`
- Modify: `packages/runtime/src/engine/workstream-machine.ts`

**Reference:** Cline `submit_and_exit` with `lifecycle.completesRun: true`.

- [ ] **Step 1: Define tool**

```ts
export function createDeclareDoneTool(ctx: ToolContext): ToolDef {
  return {
    name: 'declare_done',
    description:
      'Call when the task is verified complete. Requires a one-line summary. ' +
      'The run cannot finish without this tool in single-loop bench mode.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One-line summary of what changed.' },
      },
      required: ['summary'],
    },
    handler: async (input) => {
      const summary = String(input.summary ?? '').trim();
      if (!summary) throw new Error('summary is required');
      // Persist on run record via ctx — set run.completionSummary
      return `DONE: ${summary}`;
    },
  };
}
```

- [ ] **Step 2: Completion guard in `runToolLoop`**

When `opts.requireCompletionTool === true` and model finishes with text only (no `declare_done` in tool calls), `prepareStep` on the "would finish" step injects:

```
[SYSTEM] You must call declare_done with a summary before this run can complete.
```

Continue loop (do not treat text-only as done). Mirror Cline yolo completion reminders.

Add `requireCompletionTool?: boolean` to `RunToolLoopOptions`; set true from `call.ts` when `config.singleLoop && run.role === 'worker'`.

- [ ] **Step 3: Update single-loop prompts** in `single-loop.ts` — replace "End with DONE" text-only instruction with "Call declare_done when verified."

- [ ] **Step 4: FSM uses `declare_done` for `patchPresent`**

In `engine.ts` `gatherFacts`:

```ts
patchPresent: runs.some(
  (r) => r.role === 'worker' && r.status === 'done' && runHasSuccessfulTool(r, 'declare_done'),
),
```

Keep git-diff check (Task 2.3) as secondary validation.

---

### Task 2.3: Git-diff-based patch detection

**Files:**
- Create: `packages/runtime/src/engine/patch-facts.ts`
- Modify: `packages/runtime/src/engine/engine.ts`

- [ ] **Step 1: Implement `hasMeaningfulPatch(workspaceDir): Promise<boolean>`**

```ts
export async function hasMeaningfulPatch(workspaceDir: string): Promise<boolean> {
  // git status --short; return true if any non-empty line
  // ignore untracked-only if bench config says so (env RUNTIME_PATCH_IGNORE_UNTRACKED=false)
}
```

- [ ] **Step 2: Extend `WorkstreamFacts`**

```ts
hasGitDiff: boolean;
```

- [ ] **Step 3: Single-loop `done` requires both `declare_done` AND `hasGitDiff`** (configurable via `RUNTIME_REQUIRE_GIT_DIFF_FOR_DONE=true`).

- [ ] **Step 4: Test** — `patch-facts.test.ts` with temp git repo.

---

### Task 2.4: Phase 2 bench validation

- [ ] **Step 1: Run single-loop mini suite**

```bash
cd packages/runtime && pnpm bench:deepswe:single-loop
```

- [ ] **Step 2: Compare `attempts.json`** — verify `declare_done` appears in tool calls; fewer false-positive `done` with no diff.

- [ ] **Step 3: Commit** (when user requests)

```bash
git commit -m "feat(runtime): shell process-group kill and declare_done completion"
```

---

## Phase 3 — VCR + eval pyramid

### Task 3.1: VCR module

**Files:**
- Create: `packages/runtime/src/llm/vcr.ts`
- Create: `packages/runtime/src/llm/vcr.test.ts`

**Reference:** `../cline/sdk/packages/shared/src/vcr.ts` — slim to inference-only filter.

- [ ] **Step 1: Implement `installVcr(opts)`**

Env:
```
RUNTIME_VCR=record|playback
RUNTIME_VCR_CASSETTE=./fixtures/my-test.json
RUNTIME_VCR_FILTER=/chat/completions   # or zen path substring
```

Patch `globalThis.fetch`:
- **record**: serialize request/response pairs to cassette JSON
- **playback**: return recorded response; unmatched requests throw

Sanitize API keys in recorded bodies.

- [ ] **Step 2: Test with mock fetch** — record 1 request, playback returns same body.

- [ ] **Step 3: Export `withVcr(testFn)` helper** for test files.

---

### Task 3.2: L1 contract tests (extend existing)

**Files:**
- `packages/runtime/src/llm/message-sanitizer.test.ts` (Task 1.1)
- `packages/runtime/src/llm/loop-detection.test.ts` (Task 1.2)
- `packages/runtime/src/llm/mistake-tracker.test.ts` (Task 1.3)
- `packages/runtime/src/engine/workstream-machine.test.ts` (existing)
- `packages/runtime/src/engine/context-compact.test.ts` (existing)

- [ ] **Step 1: Add `package.json` script**

```json
"test:contract": "node --import tsx --test src/llm/*.test.ts src/engine/workstream-machine.test.ts src/engine/context-compact.test.ts src/engine/convergence.test.ts"
```

- [ ] **Step 2: Document L1 in `bench/README.md`**

```
L1 — contract (no LLM): pnpm test:contract
L2 — smoke (short scenarios): pnpm test:smoke
L3 — e2e (SWE-bench / DeepSWE): pnpm bench:deepswe
```

---

### Task 3.3: L2 smoke harness

**Files:**
- Create: `packages/runtime/bench/smoke/scenarios.json`
- Create: `packages/runtime/bench/smoke/run-smoke.sh`

**Reference:** `../cline/evals/smoke-tests/`

- [ ] **Step 1: Define 5 scenarios** (no repo required):

```json
[
  { "id": "read-and-summarize", "message": "Read package.json and summarize the name field." },
  { "id": "grep-self", "message": "Use grep to find 'runToolLoop' and report the file path." },
  { "id": "trivial-edit", "message": "Create /tmp-test.txt with content 'smoke' via write_file." },
  { "id": "shell-echo", "message": "Run echo hello via run_shell." },
  { "id": "declare-done", "message": "Echo test via run_shell then call declare_done.", "singleLoop": true }
]
```

- [ ] **Step 2: `run-smoke.sh`** — for each scenario: spawn runtime, POST message, poll until done/blocked, assert expected tools were called (parse `runs/*.json`).

- [ ] **Step 3: Add script**

```json
"test:smoke": "bash bench/smoke/run-smoke.sh"
```

- [ ] **Step 4: Optional VCR playback mode** for CI without API key:

```bash
RUNTIME_VCR=playback RUNTIME_VCR_CASSETTE=bench/smoke/fixtures/default.json pnpm test:smoke
```

---

### Task 3.4: L1 integration test with VCR

**Files:**
- Create: `packages/runtime/src/llm/loop.integration.test.ts`

- [ ] **Step 1: Record cassette** (one-time, local):

```bash
RUNTIME_VCR=record RUNTIME_VCR_CASSETTE=src/llm/fixtures/simple-tool-loop.json pnpm test:integration
```

- [ ] **Step 2: Playback test** asserts `toolCalls.length >= 1` and no throw.

- [ ] **Step 3: Add script `"test:integration"`** — runs only `*.integration.test.ts`.

---

## Phase 4 — MCP integration (strategic)

### Task 4.1: MCP config loader

**Files:**
- Create: `packages/runtime/src/mcp/config-loader.ts`
- Create: `packages/runtime/src/mcp/types.ts`

- [ ] **Step 1: Support JSON config** (Cursor-style):

```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": {} }
  }
}
```

Env: `RUNTIME_MCP_CONFIG_PATH` (optional).

- [ ] **Step 2: Parse and validate** with zod; skip disabled servers.

---

### Task 4.2: MCP manager

**Files:**
- Create: `packages/runtime/src/mcp/manager.ts`
- Create: `packages/runtime/src/mcp/manager.test.ts`

**Reference:** `../cline/sdk/packages/core/src/extensions/mcp/manager.ts`

- [ ] **Step 1: `McpManager.connectAll()`** — stdio transport per server, list tools, cache schemas.

- [ ] **Step 2: Per-server connection lock** — avoid duplicate connects.

- [ ] **Step 3: `disconnectAll()` on runtime shutdown** — wire in `src/index.ts`.

---

### Task 4.3: MCP → ToolDef adapter

**Files:**
- Create: `packages/runtime/src/mcp/tools.ts`
- Modify: `packages/runtime/src/tools/registry.ts`

- [ ] **Step 1: `createMcpTools(manager): ToolDef[]`**

Namespace tool names: `mcp__<server>__<tool>`.

- [ ] **Step 2: Handler calls `manager.callTool(server, tool, input)`**

- [ ] **Step 3: Merge into worker tool set when MCP configured** — orchestrator/planner excluded by default (configurable).

---

## Phase 5 — Tool approval policy (strategic)

### Task 5.1: Tool policy config

**Files:**
- Create: `packages/runtime/src/tools/tool-policy.ts`
- Create: `packages/runtime/src/tools/tool-policy.test.ts`
- Modify: `packages/runtime/src/config.ts`

**Reference:** `../cline/sdk/packages/shared/src/llms/tools.ts`

- [ ] **Step 1: Types**

```ts
export interface ToolPolicy {
  enabled?: boolean;
  autoApprove?: boolean;
}

export interface ToolPolicyConfig {
  global: ToolPolicy;
  tools: Record<string, ToolPolicy>;
}

export function resolveToolPolicy(toolName: string, config: ToolPolicyConfig): {
  enabled: boolean;
  autoApprove: boolean;
}
```

Merge: per-tool → global `*` → defaults `{ enabled: true, autoApprove: true }`.

Env: `RUNTIME_TOOL_POLICY_JSON` or per-tool `RUNTIME_TOOL_AUTO_APPROVE_run_shell=false`.

---

### Task 5.2: Approval gate

**Files:**
- Create: `packages/runtime/src/tools/tool-approval.ts`
- Modify: `packages/runtime/src/llm/loop.ts`

- [ ] **Step 1: `ToolApprovalFn` type**

```ts
export type ToolApprovalFn = (req: {
  toolName: string;
  input: Record<string, unknown>;
  runId: string;
}) => Promise<'approved' | 'denied'>;
```

- [ ] **Step 2: In tool execute**, before handler:

```ts
const policy = resolveToolPolicy(def.name, opts.toolPolicy);
if (!policy.enabled) return 'Error: Tool is disabled.';
if (!policy.autoApprove) {
  const decision = await opts.requestApproval?.(...) ?? 'denied';
  if (decision === 'denied') return 'Error: Tool execution denied by policy.';
}
```

- [ ] **Step 3: Default for bench** — all auto-approve (no config = current behavior).

- [ ] **Step 4: Optional HTTP endpoint** `POST /runs/:id/approve-tool` for future UI — out of scope unless exposing runtime to IDE.

---

## Phase 6 — Git checkpoints (strategic)

### Task 6.1: Checkpoint creation

**Files:**
- Create: `packages/runtime/src/engine/checkpoint.ts`
- Modify: `packages/runtime/src/engine/engine.ts`

**Reference:** `../cline/sdk/packages/core/src/hooks/checkpoint-hooks.ts`

- [ ] **Step 1: After worker run completes**, if `RUNTIME_CHECKPOINTS_ENABLED=true`:

```ts
export async function createCheckpoint(opts: {
  workspaceDir: string;
  workstreamId: string;
  turnIndex: number;
}): Promise<{ ref: string; stashId: string }>
```

Implementation: `git stash push -u -m "artificer-checkpoint-<ws>-<n>"` or temporary commit on orphan branch — pick one strategy and document.

- [ ] **Step 2: Store metadata** on workstream in `storage/types.ts`:

```ts
checkpoints?: Array<{ turnIndex: number; ref: string; createdAt: string }>;
```

---

### Task 6.2: Checkpoint restore

**Files:**
- Create: `packages/runtime/src/engine/checkpoint-restore.ts`
- Create: `packages/runtime/src/engine/checkpoint.test.ts`

- [ ] **Step 1: `restoreCheckpoint(workstreamId, turnIndex)`** — reset git state + truncate run history after that turn (or mark workstream `paused` for manual resume).

- [ ] **Step 2: HTTP API** `POST /workstreams/:id/restore-checkpoint` — optional.

---

## Cross-cutting: documentation updates

### Task DOC.1: Update bench README and .env.example

- [ ] Document all new env vars (Phases 0–3 minimum).
- [ ] Add eval pyramid section with commands.
- [ ] Note `declare_done` requirement for `--single-loop`.

### Task DOC.2: Add spec cross-reference

- [ ] Create `docs/superpowers/specs/2026-06-09-runtime-cline-harness-borrowing-design.md` (short design doc linking to this plan) — optional, only if team wants spec parity with prior borrowing work.

---

## Self-review (spec coverage)

| Recommendation | Task(s) |
|----------------|---------|
| Outdated read invalidation | 1.1 |
| Within-call loop detection | 1.2 |
| Per-iteration context budget | 1.1 (`enforceTotalTextBudget`) |
| Request diagnostics | 1.4 |
| `declare_done` completion tool | 2.2 |
| `patchPresent` / git-diff fix | 2.2, 2.3 |
| Process-tree shell kill | 2.1 |
| VCR deterministic tests | 3.1, 3.4 |
| L1/L2 eval pyramid | 3.2, 3.3 |
| MCP integration | 4.1–4.3 |
| Tool approval policy | 5.1–5.2 |
| Git checkpoints | 6.1–6.2 |

No placeholders remain; all tasks have concrete files and code sketches.

---

## Suggested execution order

1. **Phase 0 + Phase 1** — highest bench ROI; unblocks diagnostics
2. **Phase 2** — completion semantics before next DeepSWE comparison run
3. **Phase 3** — prevents regressions while iterating
4. **Phases 4–6** — when IDE / user-present features are on the roadmap

**Verification gate before claiming done (Phases 0–3):**

```bash
cd packages/runtime
pnpm type-check
pnpm test
pnpm test:contract
# optional: RUNTIME_VCR=playback ... pnpm test:smoke
pnpm bench:deepswe:single-loop  # at least mini suite
```

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-09-runtime-cline-harness-borrowing.md`.**

**Two execution options:**

1. **Subagent-driven (recommended)** — dispatch a fresh subagent per task (0.1 → 1.1 → …), review between tasks
2. **Inline execution** — implement phases sequentially in this session with checkpoints after each phase

**Which approach?**
