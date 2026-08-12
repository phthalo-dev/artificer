# Letta-Inspired Memory & DX Borrowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Artificer's memory and onboarding gaps identified in [Letta comparison research](../../research/2026-08-11-letta-comparison.md) — recall search, structured instructions, sleeptime-lite distillation, trajectory import, memory cross-links, compaction tuning, bundled skills, and Claude Code compatibility — without adopting Letta's cloud/PostgreSQL architecture or model-driven orchestration.

**Architecture:** Five independent phases, each shippable on its own. All new state stays file-backed under `ARTIFICER_EXEC_DIR` or the identity repo. No new databases. Reuse existing `IdentityStore`, `memory-search.ts`, `workstream-memory.ts`, and `context-compact.ts` primitives rather than porting Letta's MemFS projection or sleeptime multi-agent groups wholesale.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node 20+, `node:test`, existing Hono runtime, CLI (`packages/cli`), optional `@letta-ai/trajectory` as a **devDependency** for import only (evaluate license/compatibility before shipping).

**Reference research:** [docs/research/2026-08-11-letta-comparison.md](../../research/2026-08-11-letta-comparison.md)

## Global Constraints

- **Do not** add PostgreSQL, Redis, or a cloud-state requirement.
- **Do not** replace `workstream-machine.ts` with LLM-driven orchestration.
- **Do not** add Letta-style runtime mods; extensions stay in the identity repo (`defineTool`, `defineSkill`, etc.).
- Test runner: `pnpm --filter @artificer/runtime test` or `node --import tsx --test src/path/to/file.test.ts` from `packages/runtime/`
- Memories remain **pull-only** in context (signpost + `query_memories`); no auto-injection of memory bodies.
- Preserve Artificer's "autonomous colleague" framing — borrow Letta's **mechanisms**, not the "experiential entity" philosophy from `letta.md`.

## Relationship to Existing Plans

| Area | Status | This plan |
|---|---|---|
| Memory teaching (`add_memory`, librarian, signpost) | ✅ Shipped ([2026-05-29 plan](./2026-05-29-agent-memory-teaching.md)) | Extends with blocks, links, sleeptime-lite |
| Context economics (spill, microcompact, grep) | ✅ Shipped ([2026-06-01 plan](./2026-06-01-runtime-claude-code-borrowing.md)) | Phase 5 adds model-specific thresholds only |
| Recurring schedules | ✅ Shipped ([2026-07-15 plan](./2026-07-15-recurring-schedules.md)) | Phase 7 adds starter schedules + docs polish |
| Claude Code hooks (Phase C) | ⏸ Deferred in existing plan | Phase 6 picks up hooks + permissions |
| Identity evals | 📋 Separate track ([2026-08-11 plan](./2026-08-11-identity-agent-evals.md)) | No overlap |

---

## Roadmap Overview

```
Phase 1 — Instruction blocks + memory links + bundled skills     (~1 week, low risk)
Phase 2 — Recall search (search_history tool)                    (~1–2 weeks, high value)
Phase 3 — Sleeptime-lite post-turn distillation                  (~1 week, medium risk)
Phase 4 — Trajectory import CLI                                  (~1–2 weeks, onboarding win)
Phase 5 — Model-specific compaction thresholds                   (~3 days, extends existing)
Phase 6 — Claude Code hooks & permissions                        (~1–2 weeks, DX)
Phase 7 — Proactive schedules starter pack                       (~2 days, docs + scaffold)
```

Phases 1, 2, and 4 deliver the highest ROI. Phases can ship in any order; recommended sequence is **1 → 2 → 4 → 3 → 5 → 6 → 7**.

---

## Phase 1: Structured Instructions, Memory Links, Bundled Skills

**Why:** Letta's `persona` / `human` block split and operational skills (`initializing-memory`, `self-configuration`) are cheap wins that improve agent self-maintenance without new infrastructure.

### File Map

**Create:**
- `packages/runtime/src/discover/instruction-blocks.ts` — parse/compose structured instructions
- `packages/runtime/src/discover/instruction-blocks.test.ts`
- `packages/cli/templates/skills/managing-memories.md`
- `packages/cli/templates/skills/adding-custom-tools.md`
- `packages/cli/templates/skills/tuning-model-presets.md`

**Modify:**
- `packages/runtime/src/discover/discover.ts` — load blocks from `agent/instructions/` or legacy `agent/instructions.md`
- `packages/runtime/src/config.ts` — expose composed instructions string
- `packages/runtime/src/engine/roles.ts` — memory-link guidance in communicator/librarian prompts
- `packages/runtime/src/storage/identity-store.ts` — resolve `[[path]]` in memory summaries for graph hints
- `packages/cli/src/commands/init.ts` — scaffold `agent/instructions/` + copy skill templates
- `docs/guides/managing-memories.md` — document blocks + `[[path]]` convention

### Task 1: Instruction block loader

**Interfaces:**
- Produces: `loadInstructionBlocks(rootDir: string): { persona: string; human: string; project: string; legacy?: string }`, `composeInstructions(blocks): string`

- [ ] **Step 1: Write failing tests** for:
  - Legacy single-file `agent/instructions.md` still works (backward compatible)
  - New layout: `agent/instructions/persona.md`, `human.md`, `project.md` concatenated in order with `---` separators
  - Missing optional files → empty string for that block

- [ ] **Step 2: Implement** `instruction-blocks.ts` and wire into `discover.ts` / `config.ts`

- [ ] **Step 3: Update init scaffold** — create `agent/instructions/` with three starter files instead of one monolithic `instructions.md`; keep a migration note in the persona file pointing at the old layout

- [ ] **Step 4: Run tests** — `pnpm --filter @artificer/runtime test` and `pnpm --filter @artificer/cli test`

### Task 2: Memory cross-reference convention

Letta uses `[[skills/foo/SKILL.md]]` synapses. Artificer already has `related` edges in memory frontmatter — extend with lightweight `[[memory-id]]` / `[[skill-name]]` parsing.

- [ ] **Step 1: Add `parseMemoryRefs(text: string): string[]`** in `memory-search.ts` or new `memory-refs.ts` with tests for `[[note_abc]]`, `[[write-adr]]`, bare paths

- [ ] **Step 2: When formatting `query_memories` results**, append a "See also" line when refs resolve to known index entries or skill names

- [ ] **Step 3: Update librarian + communicator role prompts** (`roles.ts`) — when saving memories, link to related skills/memories via `related` frontmatter AND inline `[[...]]` refs in the body

- [ ] **Step 4: Document** in `docs/guides/managing-memories.md`

### Task 3: Bundled operational skills

- [ ] **Step 1: Author three skill templates** (modeled on Letta's `initializing-memory` but Artificer-framed):
  - `managing-memories.md` — when to use `add_memory` vs chronicles, tag conventions, preference vs claim
  - `adding-custom-tools.md` — `defineTool` pattern, restart requirement, testing
  - `tuning-model-presets.md` — presets, role tiers, quota routes, when to change complexity

- [ ] **Step 2: Copy templates in `init.ts`** to `agent/skills/` on `artificer init`

- [ ] **Step 3: Add same files to monorepo example agent** if one exists, or document in quickstart

---

## Phase 2: Recall Search (`search_history`)

**Why:** The biggest functional gap vs. Letta. Users ask "what did we discuss about X?" — today only workstream chronicles and memories help; full message/run history is not searchable.

### File Map

**Create:**
- `packages/runtime/src/storage/history-search.ts` — index + rank messages and run summaries
- `packages/runtime/src/storage/history-search.test.ts`
- `packages/runtime/src/storage/history-index.ts` — rebuild/search persisted index at `{exec}/history/index.json`
- `packages/runtime/src/tools/history.ts` — `search_history` tool

**Modify:**
- `packages/runtime/src/storage/layout.ts` — `historyIndexFile()`
- `packages/runtime/src/storage/store.ts` — hook index rebuild on `appendMessage` and run completion
- `packages/runtime/src/tools/registry.ts` — expose `search_history` to communicator, planner, librarian
- `packages/runtime/src/engine/roles.ts` — communicator prompt: use `search_history` for "what did we discuss" questions before guessing
- `docs/guides/managing-memories.md` or new `docs/guides/searching-history.md` — when to use `search_history` vs `query_memories`

### Task 1: History index schema

```ts
// packages/runtime/src/storage/history-search.ts
export interface HistoryIndexEntry {
  id: string;
  kind: 'message' | 'run';
  role?: RoleName;           // runs only
  workstreamId?: string;
  direction?: 'inbound' | 'outbound';  // messages only
  excerpt: string;           // first ~300 chars, no tool dumps
  createdAt: string;
}
```

- [ ] **Step 1: Tests** — ranking by query token overlap (reuse `tokenize` from `memory-search.ts`), date filter, role filter, workstream filter

- [ ] **Step 2: Implement pure ranking** — no embeddings in v1 (YAGNI); optional Phase 2b adds embedding hybrid using existing `memory-embeddings.ts` hasher

- [ ] **Step 3: Index rebuild** — on message append and run terminal state, upsert entry; cap index at configurable size (default 2000 entries, drop oldest)

### Task 2: `search_history` tool

**Interfaces:**
- Consumes: `HistorySearchIndex` from store
- Produces: tool `search_history` with params `{ query, limit?, since?, until?, role?, workstreamId? }`

- [ ] **Step 1: Implement tool** in `history.ts` mirroring `query_memories` response shape (bulleted excerpts + timestamps)

- [ ] **Step 2: Register** on communicator, planner, librarian in `registry.ts`

- [ ] **Step 3: Integration test** — append messages + complete a run → search finds both

- [ ] **Step 4: Update communicator role prompt** — "For questions about past conversation, call search_history before answering from memory alone."

### Task 3: Run excerpt extraction

Runs store full tool trajectories in `runs/<id>.json` — too large to index raw.

- [ ] **Step 1: Add `runSearchExcerpt(run: RunRecord): string`** — concatenate role + task + final assistant text + `submit_review` verdict if present; skip tool I/O bodies

- [ ] **Step 2: Test** on fixture run with spilled tool results — excerpt must not include spill paths' full content

---

## Phase 3: Sleeptime-Lite Distillation

**Why:** Letta runs background memory agents after every turn. Artificer only distills on workstream completion. Lightweight post-communicator distill catches preferences and facts stated in chat that never become workstreams.

### File Map

**Create:**
- `packages/runtime/src/engine/conversation-distill.ts` — cadence logic + spawn helper
- `packages/runtime/src/engine/conversation-distill.test.ts`

**Modify:**
- `packages/runtime/src/engine/engine.ts` — after communicator run completes, maybe spawn librarian distill
- `packages/runtime/src/api/types.ts` — `IdentityConfig.conversationDistill?: { enabled?: boolean; everyMessages?: number }`
- `packages/runtime/artificer.config.schema.json`
- `packages/runtime/src/engine/roles.ts` — short librarian prompt variant for conversation distill (1–3 claims max, preference-heavy)
- `docs/reference/config.md`

### Task 1: Distill cadence

- [ ] **Step 1: Config** — `conversationDistill.enabled` default `false`; `everyMessages` default `5` (count inbound messages since last distill)

- [ ] **Step 2: State** — persist `lastConversationDistillAt` + `messagesSinceDistill` in `{exec}/distill-state.json`

- [ ] **Step 3: Pure function `shouldDistill(state, config, inboundCount): boolean`** with tests

### Task 2: Fire-and-forget librarian spawn

Reuse pattern from `workstream-memory.ts` `spawnDistillIfNeeded`.

- [ ] **Step 1: `spawnConversationDistill(engine, recentMessages)`** — passes last N messages (cap 8k chars) to librarian with task: "Extract 0–3 durable preferences or claims. Skip task-specific code details. Call add_memory only for genuinely new facts."

- [ ] **Step 2: Wire into `engine.ts`** after communicator `done` status — never block reply delivery

- [ ] **Step 3: Dedup** — hash recent message ids; skip if same hash as last distill (mirror `distillSourceHash`)

- [ ] **Step 4: Eval mode guard** — no distill in eval mode (mirror `add_memory` eval guard)

---

## Phase 4: Trajectory Import

**Why:** Letta's `@letta-ai/trajectory` package is a major onboarding advantage. Users switching from Claude Code/Cursor should seed Artificer memories from prior sessions.

### File Map

**Create:**
- `packages/cli/src/commands/import-trajectories.ts`
- `packages/cli/src/commands/import-trajectories.test.ts`
- `packages/runtime/src/import/trajectory-to-memories.ts` — pure transform
- `packages/runtime/src/import/trajectory-to-memories.test.ts`

**Modify:**
- `packages/cli/src/index.ts` — register `artificer import trajectories`
- `docs/guides/agent-identity-setup.md` — new "Importing from other agents" section

### Task 1: Evaluate dependency

- [ ] **Step 1: Spike** — `pnpm add @letta-ai/trajectory` in CLI package; call `listTrajectories()` locally; inspect output shape and license (MIT expected)

- [ ] **Step 2: Decision gate** — if license incompatible or API too unstable, implement a **Claude Code-only** importer first (read `~/.claude/projects/` JSONL) without the Letta package. Document fallback in plan PR.

### Task 2: Transform normalized trajectories → memories

```ts
// packages/runtime/src/import/trajectory-to-memories.ts
export interface ImportedMemoryDraft {
  title: string;
  summary: string;
  content: string;
  tags: string[];
  kind: 'preference' | 'note' | 'claim';
  source: string;  // e.g. "trajectory:claude-code"
}
export function trajectoryToMemoryDrafts(
  normalized: unknown,
  options?: { maxMemories?: number },
): ImportedMemoryDraft[];
```

- [ ] **Step 1: Tests** with fixture JSON — extract user-stated preferences, recurring repo patterns, explicit "always/never" instructions; cap at 10 memories per import batch

- [ ] **Step 2: Do NOT import raw code diffs** — preferences and workflow patterns only (unlike Letta's full history analysis)

### Task 3: CLI command

```
artificer import trajectories [--source claude-code|codex|all] [--dry-run] [--apply]
```

- [ ] **Step 1: `--dry-run`** prints proposed `add_memory` payloads

- [ ] **Step 2: `--apply`** writes to `identity/memories/` via `IdentityStore` APIs, rebuilds index, suggests `git diff`

- [ ] **Step 3: Init scaffold note** — add to post-init README: "Coming from Claude Code? Run `artificer import trajectories --dry-run`"

---

## Phase 5: Model-Specific Compaction Thresholds

**Why:** Letta's summarizer uses per-model-family thresholds (e.g. proactive compaction at 90% for GPT-5). Artificer has microcompact + prior-run digests but uses fixed heuristics.

### File Map

**Create:**
- `packages/runtime/src/engine/compaction-thresholds.ts`
- `packages/runtime/src/engine/compaction-thresholds.test.ts`

**Modify:**
- `packages/runtime/src/engine/context-compact.ts` — accept model id, select how many prior runs to include
- `packages/runtime/src/engine/call.ts` — pass resolved model id into `buildPriorRunsDigest`
- Reference: `/Users/danielbanks/dev/letta/letta/services/summarizer/thresholds.py` for family patterns (port logic, not code)

### Task 1: Threshold table

```ts
export interface CompactionProfile {
  priorRunsToInclude: number;   // default 2
  microcompactAggressive: boolean;
}
export function compactionProfileForModel(modelId: string): CompactionProfile;
```

- [ ] **Step 1: Tests** — `gpt-5*` → aggressive (1 prior run, microcompact on); `claude-sonnet*` → default; long-context models → 3 prior runs

- [ ] **Step 2: Wire into `buildPriorRunsDigest`** — replace hardcoded run count

- [ ] **Step 3: Env override** — `RUNTIME_COMPACTION_PROFILE=aggressive|default` for bench A/B

---

## Phase 6: Claude Code Hooks & Permissions

**Why:** Aligns with external executor strategy (Claude Code, Cursor). Letta mirrors Claude Code's permission schema and lifecycle hooks — reduces migration friction.

**Reference:** Phase C in [2026-06-01-runtime-claude-code-borrowing.md](./2026-06-01-runtime-claude-code-borrowing.md) (deferred).

### File Map

**Create:**
- `packages/runtime/src/hooks/runner.ts` — load + execute hooks from `agent/hooks/`
- `packages/runtime/src/hooks/runner.test.ts`
- `packages/runtime/src/permissions/policy.ts` — allow/deny/ask rules
- `packages/runtime/src/permissions/policy.test.ts`

**Modify:**
- `packages/runtime/src/llm/loop.ts` — call pre/post tool hooks; check permission policy before execute
- `packages/runtime/src/api/types.ts` — `needsApproval` already on `defineTool`; wire it
- `packages/runtime/src/server/app.ts` — `POST /approvals/:id` if not present
- `packages/cli/src/commands/init.ts` — scaffold `agent/hooks.json` example
- Reference: `/Users/danielbanks/dev/letta-code/src/permissions/types.ts`

### Task 1: Permission policy (read-only v1)

Support Claude Code-style rules file at `agent/permissions.json`:

```json
{
  "run_shell": "ask",
  "edit_file": "allow",
  "default": "allow"
}
```

- [ ] **Step 1: Parse + match** tool name → decision (`allow` | `deny` | `ask`)

- [ ] **Step 2: `ask` pauses run** — return approval request via existing SSE/event pattern; resume on approval

- [ ] **Step 3: Worker-only in v1** — communicator/planner don't hit shell policy

### Task 2: Lifecycle hooks

Support `agent/hooks.json` pointing to shell scripts or TS files:

```json
{
  "preToolUse": [{ "command": ".artificer/hooks/pre-tool.sh" }],
  "postToolUse": [{ "command": ".artificer/hooks/post-tool.sh" }]
}
```

- [ ] **Step 1: Run hook with env** `ARTIFICER_TOOL_NAME`, `ARTIFICER_RUN_ID`, `ARTIFICER_WORKSTREAM_ID`

- [ ] **Step 2: Non-zero exit from pre-hook** → block tool execution, return stderr to model

- [ ] **Step 3: Document** in `docs/guides/custom-cli-executor.md` cross-link

---

## Phase 7: Proactive Schedules Starter Pack

**Why:** Letta's crons, heartbeats, and `/sleeptime` make proactive agents feel alive. Artificer has schedules ([shipped](./2026-07-15-recurring-schedules.md)) but no opinionated defaults.

### File Map

**Modify:**
- `packages/cli/src/commands/init.ts` — scaffold two example schedules
- `docs/guides/` — create `proactive-agent.md` (or section in deploying guide)

### Task 1: Example schedules in init

- [ ] **Step 1: `agent/schedules/weekly-digest.md`** — Monday 9am, communicator action, body: "Summarize open workstreams, stale PRs, and anything I should know this week."

- [ ] **Step 2: `agent/schedules/memory-hygiene.md`** — monthly, communicator action, body: "Review memories tagged 'draft' or older than 90 days; merge duplicates; update stale preferences."

- [ ] **Step 3: Document** enabling schedules, timezone, and `identity.pullInterval` for GitHub-edited schedules

---

## Explicitly Out of Scope

These appeared in the Letta comparison as **medium/low priority** or **do not borrow**:

| Item | Reason |
|---|---|
| MemFS projection layer | Identity repo already is the filesystem |
| PostgreSQL archival memory | Markdown + optional embeddings sufficient |
| Sleeptime multi-agent groups | Conversation distill (Phase 3) covers 80% at 20% complexity |
| Tool rules engine | Role scoping + FSM already constrain ordering |
| Mods / harness self-modification | Conflicts with identity-repo extension model |
| Voice agents, identities API, .af serialization | Wrong product shape |
| Letta Cloud / App Server integration | Opposite of self-host story |

---

## Success Metrics

| Phase | How we know it worked |
|---|---|
| 1 | New `artificer init` projects have 3 instruction files + 3 skills; existing single-file instructions still load |
| 2 | "What did we decide about auth last week?" → communicator calls `search_history` and returns grounded answer in manual test |
| 3 | After 5 inbound preference messages with distill enabled, `kind: preference` memories appear without a workstream |
| 4 | `artificer import trajectories --dry-run` shows ≥1 plausible memory from a Claude Code session on a dev machine |
| 5 | Bench shows measurable token reduction on long workstreams with aggressive profile |
| 6 | `run_shell` with `"ask"` policy pauses until UI/API approval |
| 7 | Fresh agent project fires weekly digest when schedule time is simulated in tests |

---

## Self-Review (spec coverage)

| Letta borrow item (from research) | Phase |
|---|---|
| Conversation / recall search | Phase 2 |
| Sleeptime-style distillation | Phase 3 |
| Memory block / persona split | Phase 1 |
| Trajectory import | Phase 4 |
| Reference links in memory | Phase 1 |
| Compaction sophistication | Phase 5 |
| Claude Code compatibility | Phase 6 |
| Bundled operational skills | Phase 1 |
| Cron / schedules as first-class | Phase 7 (polish on shipped feature) |
| Client tools / approval pauses | Phase 6 (`needsApproval` + permissions) |

All high-value items from the research doc have a phase. No placeholders remain.

---

## Suggested First PR

Ship **Phase 1** as a single PR (~300–500 lines): instruction blocks, `[[ref]]` convention, three bundled skills. It's backward compatible, needs no new runtime timers, and immediately improves every new `artificer init`.

Follow with **Phase 2** (`search_history`) as the highest-impact runtime feature.
