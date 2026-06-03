# Runtime Orchestration — Cost Architecture

**Date:** 2026-06-02
**Status:** Draft (for review)
**Component:** `packages/runtime`, `packages/runtime/bench`
**Related:** [Repo Orchestration design](2026-06-02-runtime-repo-orchestration-design.md), [Context Borrowing design](2026-06-01-runtime-claude-code-borrowing-design.md)
**Supersedes parts of:** the setup-gate and convergence sections of the Repo Orchestration design (those behaviors move into the state machine described here).

## Goal

Make the Artificer agentic coding runtime **cheaper per resolved instance** and **more reliably asynchronous**, without abandoning role separation. Today no benchmark instance resolves, and ~88% of spend goes to coordination, planning, and review rather than implementation. This design rewires *how roles hand off and share state* so the system spends its budget on coding, not on re-deciding and re-investigating.

Success means a `async-economy` mini-suite run that **resolves at least one instance** with a **defined, downward-trending cost-per-resolve**, with coordination cost driven toward zero.

## Guiding principle

> **Whatever can be done deterministically, should be. An LLM is involved only when a step genuinely cannot be done deterministically.**

Routing ("what is the next step?") is mechanical and belongs in code. Generative work (planning, implementing, judging correctness) needs an LLM. The current architecture pays an LLM to do routing ~9 times per task; this design removes that.

## Problem statement

### Cost attribution (evidence)

Across **15 economy-preset instances ($8.91 total)**, using model-independent signals:

| Role | Cost % | Runs | Requests | Cache-read (re-investigation) |
|------|-------:|-----:|---------:|------------------------------:|
| reviewer | 38.1% | 47 | 629 | 10.7M |
| planner | 30.3% | 49 | 528 | 8.3M |
| orchestrator | 19.6% | 134 | 637 | 2.5M |
| **worker** (implementation) | **11.8%** | 45 | 314 | 4.5M |
| communicator | 0.2% | 15 | 41 | 0.1M |
| librarian | 0% | 0 | 0 | 0 |

Three structural costs fall out of this:

1. **Routing is paid to an LLM.** The orchestrator runs ~9×/task (134 runs / 637 requests) doing mechanical gating ("plan exists? → review; approved? → worker"). It emits 2.5× the worker's output tokens, none of it code.
2. **No shared memory → constant re-investigation.** Planner + reviewer burn ~19M cache-read tokens re-reading the repo from scratch on every invocation, because each role is an isolated LLM context.
3. **Review is the most expensive role and actively harmful.** It re-explores the whole repo each pass and, because `run_shell` bypasses its read-only tool restriction, it mutates files (`sed -i`, `patch`, `git checkout HEAD~1`) — starting revert-wars with the worker and preventing convergence.

### Failure modes observed

- **Non-convergence / thrash.** Runs reach a correct candidate patch early (≈minute 8 in `run-orchestration-fix.log`) then thrash for the remaining budget. The convergence guard (`convergence.ts`) only catches two narrow patterns (3 consecutive rejected reviews; 3 adjacent planner→reviewer pairs) and misses the common worker-interleaved oscillation, so runs hit the wall and `timeout`.
- **Patch bloat.** `extract-patch.ts` stages everything (`git add -A`) and, with scattered/nested clones and agent scratch files, produces 7MB–43MB "patches" instead of a few-KB diff.
- **Unbounded hangs.** A single `run_shell` command hung ~10 minutes (≈⅓ of the budget) because the 5-minute timeout sends SIGTERM, which a hung child ignored.

## Design principles

1. **Determinism-first** (above): routing in code, LLM only for generative steps.
2. **Shared memory beats re-investigation.** Roles read a per-workstream blackboard and investigate only the gaps.
3. **One quality gate.** A single diff+test review on the candidate patch; no separate plan-review (removed to kill planner↔reviewer oscillation).
4. **Hard role boundaries.** Read-only roles cannot mutate the workspace through *any* tool, including `run_shell`.
5. **Bounded everything.** Per-state run caps, per-workstream run caps, shell kill-on-timeout, patch-size ceiling — every loop and output has a bound.
6. **Measure per phase.** Each rollout phase is independently benchmarked so cost movement is attributable.

## Architecture

Replace the **LLM orchestrator role** with a deterministic **workstream state machine** (`engine/workstream-machine.ts`) invoked by the engine after each run. Given a workstream and its blackboard, it returns the next action — *dispatch role R with task T*, or *terminate (done | blocked)* — with **no LLM call**.

Remaining LLM roles keep their responsibilities but read shared state instead of re-deriving it:

| Role | Role in new architecture | Cost today |
|------|--------------------------|-----------:|
| communicator | Intake (unchanged): parse task, `start_workstream`, seed `repoUrl`/`baseCommit`. | 0.2% |
| planner | Investigate **gaps only**; write plan steps + `testCmd` to blackboard. | 30.3% |
| worker | Implement; write patch summary + findings to blackboard. | 11.8% |
| reviewer | Diff+test, read-only, one pass; emit `{approved, issues[]}`. | 38.1% |
| **orchestrator** | **Deleted as an LLM role.** Its `invoke_call`/`update_status` become FSM-internal. | 19.6% → ~0 |
| librarian | Stays out of the coding loop. | 0% |

## Blackboard data model

A per-workstream shared record that serves two jobs: shared context (kills re-investigation) and the fact source the FSM transitions on. It is a **composed read-model over existing store data plus minimal new storage** — we do not duplicate plans or reviews.

```
Blackboard(workstreamId):
  setup:    { repoUrl, baseCommit, repoReady, repoPath }   // new fields on Workstream
  plan:     { steps[], testCmd }                            // existing plan artifact + new testCmd
  findings: [ { role, file, note, ts }, ... ]               // NEW append-only findings store
  patch:    { files[], bytes, summary }                     // derived from extract-patch + cached summary
  reviews:  [ { approved, issues[], ts }, ... ]             // existing reviews
```

**New storage surface (kept minimal):**
- `findings` table (append-only) with `record_finding` tool for all roles.
- New `Workstream` fields: `repoReady`, `repoPath`, `testCmd` (plus `repoUrl`/`baseCommit` from the related design).
- A `read_blackboard` view (or extension of `get_status`) returning the composed record.

**Context injection:** `buildContext` injects the blackboard and instructs roles to **trust it and investigate only gaps**. This is the mechanism that drops the ~19M cache-read tax.

## State machine

```
setup ──repoReady──▶ plan ──planWritten──▶ implement ──patchPresent──▶ review
  ▲                                            ▲                          │
  │ (deterministic clone into repoPath)        └──reviewRejected(issues)──┤
  └────────────────────────────────────────                     approved+patch
                                                                          ▼
                                                                        done
```

### States and transitions

| State | Entry action | Transition out |
|-------|--------------|----------------|
| `setup` | Engine clones `repoUrl` into `{workspace}/{ws}/repo` deterministically (no LLM) and checks out `baseCommit`; sets `repoReady`, `repoPath`. If no `repoUrl`, dispatch a constrained planner clone step. | `repoReady === true` → `plan` |
| `plan` | Dispatch planner: investigate gaps, write `steps[]` + `testCmd`. | plan written → `implement` (no plan-review) |
| `implement` | Dispatch worker with plan + latest review `issues[]`. | `patch.bytes > 0` → `review` |
| `review` | Dispatch reviewer (diff + findings + testCmd, read-only). | `approved` → `done`; not approved → `implement` (carry `issues[]`) |
| `done` | Terminal. | — |
| `blocked` | Terminal with structured reason. | — |

### Bounds (replace `convergence.ts`)

- **Implement↔review cycle cap** `MAX_REVIEW_CYCLES` (start at 3): exceeding → `blocked` reason `not_converging`.
- **Per-workstream run cap** (existing `maxRunsPerWorkstream`): exceeding → `blocked` reason `run_cap`.
- **Setup failure**: clone/checkout fails after retry → `blocked` reason `setup_failed` (distinct from model thrash, per the related design's B5).

The FSM is a **pure function** `(workstream, blackboard) → Action`, making transitions unit-testable without LLMs. `convergence.ts` is deleted; its intent is now encoded as cycle caps and the `approved+patch` terminal.

## Scoped review + write-guard

- **Trigger:** only when the FSM is in `review` (a candidate patch exists).
- **Input:** the diff + `blackboard.findings` + `testCmd` — **not** a fresh repo crawl.
- **Actions:** read the diff, read named files if needed, run `testCmd`.
- **Output:** structured `{ approved, issues[] }` written to `reviews`.
- **Write-guard:** in `shell.ts`, when `ctx.role === 'reviewer'`, reject mutating commands — `sed -i`, `patch`, `git checkout|reset|apply|restore`, output redirections (`>`, `>>`), `tee`, `mv`, `rm`, in-place edits. Returns a tool error directing the reviewer to record an issue instead. Ships standalone in Phase 0.

## Phase 0 hardening (independent of the architecture; ships first)

- **`extract-patch.ts`:** exclude agent scratch files (`reproduce_*.py`, `run_tests*.py`, ad-hoc `test_*` files not tracked in the base repo); refuse-and-warn when the staged diff exceeds a size ceiling instead of emitting multi-MB patches.
- **`shell.ts`:** add `killSignal: 'SIGKILL'` to the exec options and surface an explicit timeout marker in the tool output so the model learns the command hung.
- **reviewer write-guard** (above).

## What gets deleted or absorbed

| Today | Becomes |
|-------|---------|
| Orchestrator LLM role + its re-invocation in `afterRun` | Deterministic `workstream-machine.ts` |
| `convergence.ts` stall heuristics | FSM cycle caps + structured `blocked` reasons |
| Separate plan-review step (planner↔reviewer) | Removed; plan → implement directly |
| Reviewer read-only enforced only at tool-registry level | Enforced in `shell.ts` too (write-guard) |
| Setup gate as prompt guidance | FSM `setup` state with deterministic clone |

## Rollout and success metrics

Phases ship and are benchmarked independently on the `async-economy` mini-suite:

| Phase | Scope | Phase success signal |
|-------|-------|----------------------|
| 0 | patch-bounding, shell SIGKILL, reviewer write-guard | No >5min hangs; patch < ~50KB; clean cost baseline captured |
| 1 | blackboard data model + writes + context injection | planner+reviewer cache-read down ~50% |
| 2 | deterministic FSM replaces orchestrator role | orchestrator cost → ~0; total runs/task down from ~8–9 |
| 3 | scoped diff+test review | reviewer cost down; **≥1 instance resolved** on mini-suite |

**Primary metric:** cost-per-resolved-instance (undefined today — 0 resolved). **Secondary:** total runs/task, planner+reviewer cache-read tokens, setup latency, patch size.

## Testing strategy

- **TDD per change.** Each Phase 0 fix (write-guard, patch-bounding, SIGKILL) gets a failing test first.
- **FSM as pure function.** Table-driven unit tests: `(state, facts) → expected action`, covering every transition, the cycle cap, and all `blocked` reasons — no LLM in the loop.
- **Blackboard** read/write covered by store-level tests.
- **Phase gates** validated by bench re-runs, not unit tests alone — each phase compared against the captured baseline.

## Non-goals

- Collapsing to a single-agent loop (the "claude-code-borrowing" direction is a separate experiment; this design keeps role separation).
- Reintroducing a separate plan-review (deferred; may revisit if implement↔review churns on bad plans).
- Auto-resolving SWE-bench eval (Docker harness unchanged).
- Tuning model presets (orthogonal once the structure is fixed).

## Open questions

1. **Setup clone retries:** how many clone/checkout attempts before `setup_failed`? (Default: 1 retry, then block.)
2. **`MAX_REVIEW_CYCLES` value:** start at 3; revisit with bench data.
3. **Patch-size ceiling:** concrete byte limit for the warn-and-refuse path in `extract-patch.ts`.
4. **Findings retention:** is append-only with full history fine for the mini-suite, or do long workstreams need a compaction pass on `findings`?

## File change summary

| Phase | Files |
|-------|-------|
| 0 | `bench/src/extract-patch.ts` (patch-bounding), `src/tools/shell.ts` (SIGKILL + reviewer write-guard) |
| 1 | `src/storage/types.ts`, `src/storage/store.ts`, new `findings` storage, `src/engine/call.ts` (`buildContext`), `src/tools/orchestrator-tool.ts` (`record_finding`, `read_blackboard`) |
| 2 | new `src/engine/workstream-machine.ts`, `src/engine/engine.ts` (`afterRun`), delete `src/engine/convergence.ts`, `src/engine/roles.ts` (drop orchestrator role) |
| 3 | `src/engine/roles.ts` (reviewer prompt: diff+test, trust blackboard), `src/tools/registry.ts` (reviewer toolset) |

## References

- Cost data: `packages/runtime/bench/results/{async-economy,bench-budget,go-economy,phase-a-validation}/.../attempts.json`
- Thrash trajectory: `packages/runtime/bench/results/run-orchestration-fix.log`
- Patch bloat: `attempts.json` `patchBytes` (7MB / 38MB / 43MB)
- Related: `2026-06-02-runtime-repo-orchestration-design.md` (setup gate, librarian scope, `learn()` suppression — still relevant for intake)
