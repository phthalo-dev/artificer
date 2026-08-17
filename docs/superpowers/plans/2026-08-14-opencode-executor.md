# OpencodeExecutor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `opencode` CLI as a first-class `WorkerExecutor` option for Artificer's `worker` role, alongside the existing Claude Code and Cursor executors, and validate it works end-to-end (direct smoke test + one real Artificer workstream).

**Architecture:** A new `OpencodeExecutor` class in `packages/runtime/src/engine/opencode-executor.ts`, implementing the existing `WorkerExecutor` interface exactly like `ClaudeCodeExecutor`/`CursorAgentExecutor` (spawn the CLI non-interactively, write an MCP config so it can report back via `report_status`/`submit_review`, read the result off a status file on process exit). opencode's MCP config schema and prompt-delivery mechanism differ from the other two CLIs, which is why it needs its own class rather than the generic `type: "cli"` executor.

**Tech Stack:** TypeScript (Node.js ESM, `NodeNext` module resolution — internal imports use explicit `.js` extensions on `.ts` files), `node:child_process` `spawn`, no new dependencies.

## Global Constraints

- Executor `name` field must be the string `'opencode'` (matches `'claude-code'`/`'cursor-agent'` convention).
- Default model for validation runs: `opencode/gpt-5.4-mini` (confirmed available via `opencode models` against the already-authenticated local `opencode` Zen provider).
- No new automated unit tests for the `OpencodeExecutor` class itself — `ClaudeCodeExecutor`/`CursorAgentExecutor` have none either (they wrap real subprocess invocations of external binaries); validation is the manual smoke-test and real-workstream tasks below, per the approved design spec (`docs/superpowers/specs/2026-08-14-opencode-executor-design.md`).
- Follow the exact file conventions already used in `packages/runtime/src/engine/claude-code-executor.ts` and `cursor-executor.ts` (same imports, same MCP status-file read-back logic, same timeout/SIGKILL/non-zero-exit-rejects contract).
- Never print API key values to the terminal/transcript when configuring `.env` files during validation — copy them with shell redirection, don't `cat`/echo them.

---

### Task 1: Add the `OpencodeExecutor` class and wire it into the executor config system

**Files:**
- Create: `packages/runtime/src/engine/opencode-executor.ts`
- Modify: `packages/runtime/src/api/types.ts:43-57` (`ExecutorConfig` union)
- Modify: `packages/runtime/src/engine/engine.ts:32-34` (imports), `packages/runtime/src/engine/engine.ts:1404-1416` (`buildExecutor`)
- Modify: `packages/runtime/src/engine/provider-router.ts:9-10` (imports), `packages/runtime/src/engine/provider-router.ts:95-105` (`executorForRoute`)

**Interfaces:**
- Consumes: `WorkerExecutor`, `ExecutorResult`, `ExecutorReview` from `packages/runtime/src/engine/executor.ts` (already exist, unchanged); `WorkerStatus` from `packages/runtime/src/engine/worker-report.ts` (already exists, unchanged); `RunRecord` from `packages/runtime/src/storage/types.ts` (already exists, unchanged).
- Produces: `export class OpencodeExecutor implements WorkerExecutor` with `readonly name = 'opencode'` and `constructor(private readonly model?: string)`, matching the exact shape of `ClaudeCodeExecutor`/`CursorAgentExecutor` so Task 2/4 and any future caller can construct it as `new OpencodeExecutor()` or `new OpencodeExecutor('opencode/gpt-5.4-mini')`.

- [ ] **Step 1: Create `packages/runtime/src/engine/opencode-executor.ts`**

```ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunRecord } from '../storage/types.js';
import type {
  ExecutorReview,
  ExecutorResult,
  WorkerExecutor,
} from './executor.js';
import type { WorkerStatus } from './worker-report.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const MCP_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-status-server.mjs',
);
const MCP_SERVER_ID = 'artificer-status';

export class OpencodeExecutor implements WorkerExecutor {
  readonly name = 'opencode';

  constructor(private readonly model?: string) {}

  execute({
    context,
    workspaceDir,
  }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
  }): Promise<ExecutorResult> {
    const statusFile = path.join(workspaceDir, '.artificer-status.json');
    // opencode discovers MCP servers from a project-level opencode.json
    // (walking up from cwd) — there is no --mcp-config flag, so this must
    // live at the workspace root under opencode's own config file name.
    const mcpConfigFile = path.join(workspaceDir, 'opencode.json');

    fs.writeFileSync(
      mcpConfigFile,
      JSON.stringify({
        mcp: {
          [MCP_SERVER_ID]: {
            type: 'local',
            command: [process.execPath, MCP_SERVER, statusFile],
            enabled: true,
          },
        },
      }),
    );

    // Clean up any status file from a previous run
    fs.rmSync(statusFile, { force: true });

    return new Promise((resolve, reject) => {
      const args = [
        'run',
        context,
        '--dangerously-skip-permissions',
        '--dir',
        workspaceDir,
      ];
      if (this.model) args.push('--model', this.model);

      const child = spawn('opencode', args, {
        cwd: workspaceDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('opencode agent timed out'));
      }, TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timer);
        const text = Buffer.concat(stdout).toString('utf-8').trim();

        // Read MCP-reported tool result if a tool was called
        let workerStatus: WorkerStatus | undefined;
        let workerSummary: string | undefined;
        let workerFollowUps: string | undefined;
        let review: ExecutorReview | undefined;
        try {
          if (fs.existsSync(statusFile)) {
            const raw = JSON.parse(
              fs.readFileSync(statusFile, 'utf-8'),
            ) as Record<string, unknown>;
            if (raw.tool === 'submit_review') {
              review = {
                target: String(raw.target ?? 'work'),
                notes: String(raw.notes ?? ''),
                approved: Boolean(raw.approved),
                stage: (raw.stage as 'plan' | 'work' | undefined) ?? 'work',
                severity: raw.severity as
                  | ExecutorReview['severity']
                  | undefined,
              };
            } else {
              workerStatus = raw.status as WorkerStatus | undefined;
              workerSummary = raw.summary as string | undefined;
              workerFollowUps = raw.followUps as string | undefined;
            }
          }
        } catch {
          /* ignore malformed status file */
        }

        if (code !== 0) {
          const errText = Buffer.concat(stderr).toString('utf-8').trim();
          reject(
            new Error(
              `opencode agent exited with code ${code}: ${errText || text}`,
            ),
          );
        } else {
          resolve({
            text: text || '(no output)',
            usage: { inputTokens: 0, outputTokens: 0 },
            workerStatus,
            workerSummary,
            workerFollowUps,
            review,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
```

- [ ] **Step 2: Type-check the new file in isolation**

Run: `pnpm --filter @artificer-ai/runtime type-check`
Expected: PASS (the new file is valid TS on its own; it isn't imported anywhere yet, so this only confirms the file itself compiles cleanly).

- [ ] **Step 3: Add `opencode` to `ExecutorConfig` in `packages/runtime/src/api/types.ts`**

Find (lines 43-57):

```ts
export type ExecutorConfig =
  | 'llm'
  | 'cursor-agent'
  | 'claude-code'
  | { type: 'cursor-agent'; model?: string }
  | { type: 'claude-code'; model?: string }
  | {
      type: 'cli';
      command: string;
      args: string[];
      promptMode: 'stdin' | 'arg';
      model?: string;
      timeout?: number;
      mcpConfigPath?: string;
    };
```

Replace with:

```ts
export type ExecutorConfig =
  | 'llm'
  | 'cursor-agent'
  | 'claude-code'
  | 'opencode'
  | { type: 'cursor-agent'; model?: string }
  | { type: 'claude-code'; model?: string }
  | { type: 'opencode'; model?: string }
  | {
      type: 'cli';
      command: string;
      args: string[];
      promptMode: 'stdin' | 'arg';
      model?: string;
      timeout?: number;
      mcpConfigPath?: string;
    };
```

- [ ] **Step 4: Wire `buildExecutor()` in `packages/runtime/src/engine/engine.ts`**

Find the import block (lines 32-34):

```ts
import { CursorAgentExecutor } from './cursor-executor.js';
import { ClaudeCodeExecutor } from './claude-code-executor.js';
import { CliExecutor } from './cli-executor.js';
```

Replace with:

```ts
import { CursorAgentExecutor } from './cursor-executor.js';
import { ClaudeCodeExecutor } from './claude-code-executor.js';
import { OpencodeExecutor } from './opencode-executor.js';
import { CliExecutor } from './cli-executor.js';
```

Find `buildExecutor()` (lines 1404-1416):

```ts
function buildExecutor(
  config: RuntimeConfig['executor'],
): WorkerExecutor | undefined {
  if (!config || config === 'llm') return undefined;
  if (config === 'cursor-agent') return new CursorAgentExecutor();
  if (config === 'claude-code') return new ClaudeCodeExecutor();
  if (config.type === 'cursor-agent')
    return new CursorAgentExecutor(config.model);
  if (config.type === 'claude-code')
    return new ClaudeCodeExecutor(config.model);
  if (config.type === 'cli') return new CliExecutor(config);
  return undefined;
}
```

Replace with:

```ts
function buildExecutor(
  config: RuntimeConfig['executor'],
): WorkerExecutor | undefined {
  if (!config || config === 'llm') return undefined;
  if (config === 'cursor-agent') return new CursorAgentExecutor();
  if (config === 'claude-code') return new ClaudeCodeExecutor();
  if (config === 'opencode') return new OpencodeExecutor();
  if (config.type === 'cursor-agent')
    return new CursorAgentExecutor(config.model);
  if (config.type === 'claude-code')
    return new ClaudeCodeExecutor(config.model);
  if (config.type === 'opencode') return new OpencodeExecutor(config.model);
  if (config.type === 'cli') return new CliExecutor(config);
  return undefined;
}
```

- [ ] **Step 5: Wire `executorForRoute()` in `packages/runtime/src/engine/provider-router.ts`**

Find the import block (lines 9-10):

```ts
import { CursorAgentExecutor } from './cursor-executor.js';
import { ClaudeCodeExecutor } from './claude-code-executor.js';
```

Replace with:

```ts
import { CursorAgentExecutor } from './cursor-executor.js';
import { ClaudeCodeExecutor } from './claude-code-executor.js';
import { OpencodeExecutor } from './opencode-executor.js';
```

Find `executorForRoute()` (lines 95-105):

```ts
export function executorForRoute(
  route: DispatchRoute,
  buildExecutor: (executor?: ExecutorConfig) => WorkerExecutor | undefined,
  globalExecutor?: WorkerExecutor,
): WorkerExecutor | undefined {
  if (route.useLlmForWorkRoles) return undefined;
  if (route.profileId === 'primary') return globalExecutor;
  if (route.executorName === 'cursor-agent') return new CursorAgentExecutor();
  if (route.executorName === 'claude-code') return new ClaudeCodeExecutor();
  return globalExecutor;
}
```

Replace with:

```ts
export function executorForRoute(
  route: DispatchRoute,
  buildExecutor: (executor?: ExecutorConfig) => WorkerExecutor | undefined,
  globalExecutor?: WorkerExecutor,
): WorkerExecutor | undefined {
  if (route.useLlmForWorkRoles) return undefined;
  if (route.profileId === 'primary') return globalExecutor;
  if (route.executorName === 'cursor-agent') return new CursorAgentExecutor();
  if (route.executorName === 'claude-code') return new ClaudeCodeExecutor();
  if (route.executorName === 'opencode') return new OpencodeExecutor();
  return globalExecutor;
}
```

- [ ] **Step 6: Type-check and lint the whole package**

Run: `pnpm --filter @artificer-ai/runtime type-check`
Expected: PASS

Run: `pnpm --filter @artificer-ai/runtime lint`
Expected: PASS (if it fails on formatting, run `pnpm --filter @artificer-ai/runtime exec prettier --write packages/runtime/src/engine/opencode-executor.ts packages/runtime/src/api/types.ts packages/runtime/src/engine/engine.ts packages/runtime/src/engine/provider-router.ts` and re-run lint)

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/engine/opencode-executor.ts packages/runtime/src/api/types.ts packages/runtime/src/engine/engine.ts packages/runtime/src/engine/provider-router.ts
git commit -m "$(cat <<'EOF'
feat(runtime): add OpencodeExecutor for the opencode CLI as a worker backend

Follows the existing ClaudeCodeExecutor/CursorAgentExecutor pattern.
opencode's MCP config schema and prompt-delivery mechanism differ from
Claude Code/Cursor, so it gets a dedicated executor class rather than
using the generic type:"cli" config.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Direct smoke test — validate the MCP/status-file wiring

**Files:**
- Create (scratch, NOT committed): a throwaway script under the session scratchpad directory, e.g. `<scratchpad>/opencode-executor-smoke.ts`
- Create (scratch, NOT committed): a throwaway workspace directory, e.g. `<scratchpad>/opencode-smoke-workspace/`

**Interfaces:**
- Consumes: `OpencodeExecutor` from Task 1 (`packages/runtime/src/engine/opencode-executor.ts`), imported by absolute path since this script lives outside the `packages/runtime` package.

This task has no code to merge into the repo — its only deliverable is confidence that `OpencodeExecutor` actually drives `opencode` correctly (MCP config recognized, `report_status` called, clean exit) before building anything on top of it.

- [ ] **Step 1: Create the scratch workspace directory**

```bash
mkdir -p "<scratchpad>/opencode-smoke-workspace"
```

(Replace `<scratchpad>` with the actual scratchpad path for this session throughout this task.)

- [ ] **Step 2: Write the smoke test script**

Create `<scratchpad>/opencode-executor-smoke.ts`:

```ts
import { OpencodeExecutor } from '/Users/danielbanks/dev/artificer/packages/runtime/src/engine/opencode-executor.js';
import type { RunRecord } from '/Users/danielbanks/dev/artificer/packages/runtime/src/storage/types.js';

const executor = new OpencodeExecutor('opencode/gpt-5.4-mini');

const fakeRun = {
  id: 'smoke-run-1',
  role: 'worker',
  task: 'smoke test',
  status: 'running',
  toolCalls: [],
  usage: { inputTokens: 0, outputTokens: 0 },
  createdAt: new Date().toISOString(),
} as unknown as RunRecord;

const task = [
  'In this workspace directory, create a file src/string-utils.ts',
  'exporting a function `titleCase(str: string): string` that capitalizes',
  'the first letter of each word. Also create src/string-utils.test.ts',
  'with at least one test for it using node:test and node:assert. Then',
  'call the report_status MCP tool with status "done" and a one-sentence summary.',
].join(' ');

const result = await executor.execute({
  context: task,
  workspaceDir: '<scratchpad>/opencode-smoke-workspace',
  run: fakeRun,
});

console.log(JSON.stringify(result, null, 2));
```

Replace the two `<scratchpad>` placeholders in this file with the actual absolute scratchpad path before running.

- [ ] **Step 3: Run the smoke script**

```bash
npx tsx "<scratchpad>/opencode-executor-smoke.ts"
```

Expected: the script prints a JSON `ExecutorResult` object. Check specifically:
- `workerStatus` is `"done"` (confirms `report_status` was actually called over MCP — if this is `undefined`, the MCP wiring didn't work and `text` will contain opencode's raw stdout instead, which is the fallback path to debug from).
- No thrown/rejected error (a non-zero opencode exit or timeout would reject the promise and crash the script with a stack trace instead of printing JSON).

- [ ] **Step 4: Verify the files opencode actually wrote**

```bash
cat "<scratchpad>/opencode-smoke-workspace/src/string-utils.ts"
cat "<scratchpad>/opencode-smoke-workspace/src/string-utils.test.ts"
node --test "<scratchpad>/opencode-smoke-workspace/src/string-utils.test.ts"
```

Expected: both files exist with plausible content, and the test passes. This is not a pass/fail gate for the plan (opencode's output quality is not something this plan controls) — it's evidence the executor correctly delivered the prompt and correctly captured the result, which is what this task exists to confirm.

- [ ] **Step 5: No commit for this task**

Nothing here belongs in the repo. Optionally clean up:

```bash
rm -rf "<scratchpad>/opencode-smoke-workspace" "<scratchpad>/opencode-executor-smoke.ts"
```

---

### Task 3: Document the new executor

**Files:**
- Create: `docs/guides/opencode-executor.md`
- Modify: `docs/guides/custom-cli-executor.md` (add a cross-link in "Related docs")

**Interfaces:**
- Consumes: nothing code-level — this is documentation only, describing the `{"executor": {"type": "opencode", "model": "..."}}` config shape added in Task 1.
- Produces: a guide page other guides/READMEs can link to.

- [ ] **Step 1: Create `docs/guides/opencode-executor.md`**

```markdown
# Using opencode as the Worker Executor

This guide explains how to configure Artificer to use [opencode](https://opencode.ai) as its worker executor instead of the built-in LLM loop.

When opencode is the executor, Artificer's planner and reviewer roles still run as normal LLM calls. Only the **worker** role is handed off — Artificer writes a task prompt and opencode runs it autonomously in the workspace.

## Prerequisites

- Node.js 21 or later
- The `opencode` CLI installed and authenticated
- An Artificer identity directory with a working `artificer.config.json`

## 1. Install opencode

```bash
npm install -g opencode-ai@latest
```

Verify the install:

```bash
opencode --version
```

## 2. Authenticate opencode

opencode needs at least one configured model provider before it can run headlessly. From any directory:

```bash
opencode auth
```

Follow the prompts to sign in (e.g. to an OpenCode Zen account) or configure a provider API key. Credentials are stored globally (`~/.local/share/opencode/auth.json`), so this is a one-time step.

Check which models are available to you:

```bash
opencode models
```

## 3. Configure the Executor

In your `artificer.config.json`, add an `executor` block:

```json
{
  "name": "YourAgentName",
  "executor": {
    "type": "opencode",
    "model": "opencode/gpt-5.4-mini"
  }
}
```

`model` is optional — omit it to let opencode use its own configured default. The model string format is `<provider>/<model>` (run `opencode models` to list valid values for your account).

## 4. How it works

When Artificer runs a worker task, it:

1. Writes `{ "mcp": { "artificer-status": { "type": "local", "command": [...], "enabled": true } } }` to `{workspaceDir}/opencode.json`. opencode discovers this automatically by walking up from its working directory — there's no `--mcp-config` flag to pass a path explicitly, unlike Claude Code.
2. Spawns `opencode run "<task>" --dangerously-skip-permissions --dir <workspaceDir> [--model <model>]`.
3. opencode reads the MCP config at startup and connects to the Artificer status server.
4. When opencode calls `report_status` or `submit_review` via MCP, Artificer captures the result and advances the workstream state machine.
5. On process exit, Artificer reads the result and continues orchestration as normal.

### The `--dangerously-skip-permissions` flag

opencode's non-interactive mode auto-*rejects* every tool-call permission prompt by default, including the `report_status`/`submit_review` MCP calls — unlike some other CLIs that default to allow. `--dangerously-skip-permissions` is required for unattended runs; without it, opencode will silently fail to call back into Artificer's status server.

### Timeout

Worker runs default to 10 minutes, matching the Claude Code executor. This isn't currently configurable per-executor the way the generic `cli` executor's `timeout` field is — file an issue if you need a longer window for large tasks.

## 5. Verify it's working

Start Artificer and send a message that triggers a workstream. Check the run log in the Artificer UI — worker runs should show `executor: opencode`, and the output should come from opencode's response. If `report_status` was called, you'll see a structured status and summary rather than raw stdout.

## Known limitations

- **No usage stats.** opencode's default (non-JSON) output doesn't surface token usage, so `usage` is always reported as `{ inputTokens: 0, outputTokens: 0 }` — cost tracking for opencode-executed work isn't currently possible.
- **`opencode.json` is overwritten on every run.** Each workstream runs in a fresh cloned workspace, so this is normally harmless, but don't hand-edit MCP config into a workspace opencode will reuse across runs.
- **Requires local opencode auth already configured** (`opencode auth`/`opencode providers`) — Artificer does not manage opencode's own provider credentials.

## Related docs

- [Custom CLI Executors](./custom-cli-executor.md) — the generic `cli` executor for CLIs that don't need a dedicated integration
- [Setting Up an Agent Identity Repo](./agent-identity-setup.md) — configure your agent project before adding an executor
```

- [ ] **Step 2: Add a cross-link from `docs/guides/custom-cli-executor.md`**

Find (end of file):

```markdown
## Related docs

- [Using Qwen Code as the Worker Executor](./qwen-code-executor.md) — a concrete walkthrough using the `cli` executor with Qwen Code
- [Setting Up an Agent Identity Repo](./agent-identity-setup.md) — configure your agent project before adding an executor
```

Replace with:

```markdown
## Related docs

- [Using Qwen Code as the Worker Executor](./qwen-code-executor.md) — a concrete walkthrough using the `cli` executor with Qwen Code
- [Using opencode as the Worker Executor](./opencode-executor.md) — a dedicated (non-`cli`-type) executor, for CLIs whose MCP config doesn't fit this generic template
- [Setting Up an Agent Identity Repo](./agent-identity-setup.md) — configure your agent project before adding an executor
```

- [ ] **Step 3: Commit**

```bash
git add docs/guides/opencode-executor.md docs/guides/custom-cli-executor.md
git commit -m "$(cat <<'EOF'
docs: add opencode executor guide

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full workstream validation via the eval harness

**Files:**
- Create (scratch, outside the repo, NOT committed): a scratch Artificer identity directory, e.g. `<scratchpad>/opencode-worker-eval-identity/`

**Interfaces:**
- Consumes: the `opencode` executor config wired in Task 1, exercised through the real `artificer` CLI and `@artificer-ai/eval`'s `runIdentityEval` — this is the actual production runtime (`artificer eval run` spawns the real `@artificer-ai/runtime` server process reading the identity's `artificer.config.json` through its normal startup path), not a simplified test harness.
- Produces: an eval results directory (`eval-report.json`, `attempts.json`, `runs/<taskId>.json`) demonstrating a real planner → worker(opencode) → reviewer pass.

- [ ] **Step 1: Scaffold a scratch identity**

```bash
cd "<scratchpad>"
artificer init opencode-worker-eval-identity
cd opencode-worker-eval-identity
npm install
```

- [ ] **Step 2: Set the executor in `artificer.config.json`**

Open the generated `artificer.config.json` (it will look like the example in `docs/guides/agent-identity-setup.md`) and add the `executor` field:

```json
{
  "name": "opencode-worker-eval-identity",
  "executor": {
    "type": "opencode",
    "model": "opencode/gpt-5.4-mini"
  }
}
```

Keep any other fields `artificer init` already generated (e.g. `identity`).

- [ ] **Step 3: Configure `.env` with an LLM key for the planner/reviewer roles**

The opencode CLI's own auth (from Task 3's prerequisites) covers the worker role only. The planner/reviewer roles still run through Artificer's own LLM loop and need `LLM_API_KEY`/`LLM_BASE_URL`. Reuse the OpenCode Zen credentials already configured for this monorepo's own bench runs, without printing them to the terminal. `artificer init` may have already scaffolded `.env` with empty placeholder lines for these keys, so remove any existing lines first — otherwise a dotenv parser may keep the first (empty) occurrence and ignore the real value appended after it:

```bash
sed -i '' '/^LLM_API_KEY=/d;/^LLM_BASE_URL=/d' .env
grep '^LLM_API_KEY=' /Users/danielbanks/dev/artificer/packages/runtime/.env >> .env
grep '^LLM_BASE_URL=' /Users/danielbanks/dev/artificer/packages/runtime/.env >> .env
```

If either `grep` comes back empty (the source `.env` may have changed since this plan was written), open `/Users/danielbanks/dev/artificer/packages/runtime/.env` directly and copy the two values, or ask the user for a Zen `LLM_API_KEY`.

- [ ] **Step 4: Copy the eval task pack**

```bash
mkdir -p agent/evals
cp -R /Users/danielbanks/dev/artificer/evals/examples/runtime-dev/* agent/evals/
```

- [ ] **Step 5: Run one task through the full pipeline**

```bash
artificer eval run --task workstream-status-api
```

Expected: the command prints `Results: <resultsDir>`. This runs a real workstream: planner (Artificer's own LLM loop) plans against the `workstream-status-api` fixture, the worker role is handed to `opencode run` via `OpencodeExecutor`, and the reviewer (Artificer's own LLM loop) reviews the result, all against the local `fixture/` mini-repo — no GitHub credentials or network access to any real repo involved.

- [ ] **Step 6: Inspect the result**

```bash
cat "<resultsDir>/eval-report.json"
cat "<resultsDir>/runs/workstream-status-api.json"
```

Check specifically:
- `eval-report.json` shows the task graded (the fixture's `grade.command`, `node --test tests/*.test.js`, ran and reported pass/fail for the patch opencode produced).
- The relevant run record(s) in `runs/workstream-status-api.json` have `"executor": "opencode"` on the worker run (confirms the new executor was actually dispatched, not a fallback to the internal LLM loop).

- [ ] **Step 7: No commit for this task**

The scratch identity lives outside the artificer repo and is not part of it. Report the outcome (pass/fail, and anything notable about opencode's behavior as a worker) back in conversation — this is the final validation deliverable for this plan, not a code change.

---

## Post-Task-4 addendum (added after live validation surfaced a security-relevant finding)

Task 4's live validation (via `artificer dev` + `POST /api/workstreams`, since `artificer eval run` was found not to read `artificer.config.json` at all — a separate, pre-existing, out-of-scope bug filed as a follow-up, not fixed here) confirmed `OpencodeExecutor` correctly dispatches for all `WORK_ROLES` and round-trips MCP `report_status`/`submit_review` cleanly. It also surfaced two real problems, both addressed by the two tasks below:

1. **Security-relevant**: `OpencodeExecutor` spawns opencode with `--dangerously-skip-permissions`, which blanket-bypasses opencode's own `external_directory` permission guard. The shared prompt-builder (`packages/runtime/src/engine/call.ts`'s `buildContext()`, used by every executor and the internal loop alike) includes a literal `Repository: ${ws.repoUrl}` line. Artificer's internal tools are hardcoded to the workspace directory regardless of this text, so it's inert for them — but opencode is a general filesystem-capable agent and, in the live test, read that literal absolute path, decided to operate there instead of its `--dir`-rooted workspace, hit its own `external_directory` guard, and had it silently auto-approved by the skip flag. Real, correct files were written to the *original* (non-sandboxed) repo path while Artificer's orchestration recorded the workstream `done`/`approved` via MCP with no signal the tracked workspace was untouched. Fixed by Task 5, scoped to `OpencodeExecutor` only (not touching the shared `buildContext()`/`call.ts`, which is broader and affects other executors too — deferred as a separate follow-up).
2. **Docs accuracy**: `docs/guides/opencode-executor.md` (added in Task 3) claims "Only the worker role is handed off" — the live run showed all three `WORK_ROLES` (`planner`, `worker`, `reviewer`) route through the configured executor once one is set. Fixed by Task 6.

---

### Task 5: Replace `--dangerously-skip-permissions` with a scoped opencode permission config

**Files:**
- Modify: `packages/runtime/src/engine/opencode-executor.ts:39-62`

**Interfaces:**
- Consumes: nothing new — same `WorkerExecutor.execute()` signature from Task 1, unchanged.
- Produces: no interface change; same `OpencodeExecutor` class, same public shape. Only the internal `opencode.json` content and spawn `args` change.

Research confirmed the exact opencode permission schema (`packages/core/src/v1/config/permission.ts` in the opencode source repo at `/Users/danielbanks/dev/opencode`): a top-level `permission` object where each key is a permission category (known categories include `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `todowrite`, `question`, `webfetch`, `websearch`, `lsp`, `doom_loop`, `skill`) or an exact MCP-tool permission key (format `<sanitizedServerName>_<sanitizedToolName>`, e.g. `artificer-status_report_status`), each mapped to `"allow" | "ask" | "deny"`. Rule evaluation is "last matching key wins" — JSON key insertion order is precedence order, so a later key overrides an earlier wildcard. A `"deny"` rule is enforced by the permission service itself *before* any `permission.asked` event fires, so it cannot be bypassed by `--dangerously-skip-permissions`/`--auto`/`--yolo` regardless of whether that flag is present. `external_directory` is evaluated once per operation that would touch a path outside the `--dir` root (`packages/opencode/src/tool/external-directory.ts` in the opencode source) — operations fully inside the workspace never trigger this permission check at all, so `"external_directory": "deny"` has zero effect on legitimate in-workspace work.

- [ ] **Step 1: Update the MCP config write in `opencode-executor.ts`**

Find (current content, written by Task 1):

```ts
    fs.writeFileSync(
      mcpConfigFile,
      JSON.stringify({
        mcp: {
          [MCP_SERVER_ID]: {
            type: 'local',
            command: [process.execPath, MCP_SERVER, statusFile],
            enabled: true,
          },
        },
      }),
    );
```

Replace with:

```ts
    fs.writeFileSync(
      mcpConfigFile,
      JSON.stringify({
        mcp: {
          [MCP_SERVER_ID]: {
            type: 'local',
            command: [process.execPath, MCP_SERVER, statusFile],
            enabled: true,
          },
        },
        // Explicit allow-list instead of --dangerously-skip-permissions:
        // that flag blanket-bypasses opencode's own external_directory
        // guard, which is the only thing stopping opencode from acting on
        // an absolute path mentioned in its prompt (e.g. the workstream's
        // original repoUrl) instead of staying inside --dir. Key order is
        // permission precedence (last match wins) — external_directory
        // must stay after '*' to override it.
        permission: {
          '*': 'allow',
          [`${MCP_SERVER_ID}_report_status`]: 'allow',
          [`${MCP_SERVER_ID}_submit_review`]: 'allow',
          external_directory: 'deny',
        },
      }),
    );
```

- [ ] **Step 2: Remove `--dangerously-skip-permissions` from the spawn args**

Find:

```ts
      const args = [
        'run',
        context,
        '--dangerously-skip-permissions',
        '--dir',
        workspaceDir,
      ];
```

Replace with:

```ts
      const args = ['run', context, '--dir', workspaceDir];
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm --filter @artificer-ai/runtime type-check`
Expected: PASS

Run: `pnpm --filter @artificer-ai/runtime lint`
Expected: PASS

- [ ] **Step 4: Live re-validation — reproduce the exact leak scenario and confirm it's now blocked**

This is a security fix; the acceptance test is reproducing the exact failure Task 4 found and confirming it no longer happens, not just a type-check pass.

```bash
mkdir -p "<scratchpad>/opencode-fix-target-repo"
cd "<scratchpad>/opencode-fix-target-repo"
git init -q
echo '{"name":"opencode-fix-target","type":"module","private":true}' > package.json
git add -A && git commit -q -m "initial commit"
```

Reuse the scratch identity from Task 4 (`<scratchpad>/opencode-worker-eval-identity`, `artificer.config.json` already has `"executor": {"type": "opencode", "model": "opencode/gpt-5.4-mini"}`) if it's still intact; otherwise recreate it per Task 4 Steps 1-3. Start `artificer dev` from it (same pattern as Task 4 Step 3), wait for the "listening on" log line, then:

```bash
curl -s -X POST http://localhost:<port>/api/workstreams \
  -H 'Content-Type: application/json' \
  -d '{"title":"Add reverseString utility",
       "goal":"Add a function reverseString(str) to src/string-utils.ts that reverses a string, with a unit test in src/string-utils.test.ts using node:test and node:assert.",
       "repoUrl":"<scratchpad>/opencode-fix-target-repo",
       "autostart":true,
       "submitPr":false}'
```

Poll `GET http://localhost:<port>/api/workstreams/<id>` until terminal status (same pattern as Task 4). Then check, in this order:

1. `run.executor` on the worker role's run record is still `"opencode"` and MCP `report_status`/`submit_review` still round-trip correctly (proves the permission config didn't break the working parts — `'*': 'allow'` plus the two explicit MCP-tool allows should keep this working exactly as Task 4 validated).
2. **The critical check**: `find <scratchpad>/opencode-fix-target-repo -iname '*string-utils*'` finds **nothing** (the original path is untouched this time), and the sandboxed workspace clone under the exec dir (`~/.artificer/opencode-worker-eval-identity/workspace/<workstreamId>/repo/`) **does** contain the new `string-utils.ts`/`string-utils.test.ts` files. This is the inverse of Task 4's finding — files must land in the sandboxed clone, not the original path.
3. Check opencode's own log (`~/.local/share/opencode/log/opencode.log`, filtered to this run) for an `external_directory` permission entry with `action=deny` (or equivalent denial) when opencode attempted the original path — confirms the deny rule actually fired, not just that opencode happened not to try.

Stop the backgrounded `artificer dev` process when done (`kill <pid>`), confirm no orphaned process remains, confirm `git status --short` in the worktree shows no unexpected changes (this step touches no artificer-repo files, only the worktree's already-modified `opencode-executor.ts` from Step 1-2 above).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/opencode-executor.ts
git commit -m "$(cat <<'EOF'
fix(runtime): scope OpencodeExecutor permissions instead of skipping them

--dangerously-skip-permissions blanket-bypassed opencode's own
external_directory guard, letting it act on the literal repoUrl path
leaked into its prompt by the shared buildContext() instead of staying
inside the --dir workspace. Replace it with an explicit permission
config: allow everything needed for normal operation and the MCP status
tools, deny external_directory outright (enforced before any
permission.asked event, so it can't be silently auto-approved).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Fix the "only worker role" claim in the docs

**Files:**
- Modify: `docs/guides/opencode-executor.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a documentation correction only.

- [ ] **Step 1: Correct the role-scoping claim**

Find:

```markdown
When opencode is the executor, Artificer's planner and reviewer roles still run as normal LLM calls. Only the **worker** role is handed off — Artificer writes a task prompt and opencode runs it autonomously in the workspace.
```

Replace with:

```markdown
When opencode is the executor, every `WORK_ROLES` role — `planner`, `worker`, and `reviewer` — is handed off to it, not just the worker. Artificer writes a role-specific prompt and opencode runs it autonomously in the workspace for each of the three; only roles outside `WORK_ROLES` (e.g. `communicator`, `librarian`) still run through Artificer's internal LLM loop.
```

- [ ] **Step 2: Verify no other part of the doc repeats the old claim**

```bash
grep -n "worker.*role.*handed off\|Only the.*worker" docs/guides/opencode-executor.md
```

Expected: no matches after Step 1's edit (confirms this was the only place the claim appeared).

- [ ] **Step 3: Commit**

```bash
git add docs/guides/opencode-executor.md
git commit -m "$(cat <<'EOF'
docs: correct opencode executor role-scoping claim

Live validation showed all WORK_ROLES (planner/worker/reviewer) route
through a configured executor, not just worker.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
