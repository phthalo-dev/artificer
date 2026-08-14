# Identity Evals Phase 3 Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 3 power-user packs: `artificer eval run --pack swebench-lite-30`, a consumer GitHub Action recipe for evals on `agent/` PRs, and an opt-in `llm-judge` grader.

**Architecture:** Packs are named bundles in `@artificer-ai/eval` that synthesize identity-eval tasks (no write into the identity repo). SWE-bench instances become `repo-patch` tasks graded with `grade.type: "swebench"` (predictions.jsonl + optional official Docker harness). LLM-as-judge is a first-class grader that throws unless `--llm-judge` or `ARTIFICER_EVAL_LLM_JUDGE=true`.

**Tech Stack:** Existing `@artificer-ai/eval` driver, HF datasets-server loader (`bench/dataset.ts`), SWE-bench harness script under `packages/runtime/bench/eval/`.

## Global Constraints

- Do not write pack files into the identity git tree.
- Do not add a runtime → eval package dependency.
- LLM-as-judge never runs without explicit opt-in.
- SWE-bench correctness grading requires Docker + `swebench`; without them, record patches and leave tasks ungraded.

---

### Task 1: Pack registry + SWE-bench task synthesis

- Create: `packages/eval/src/packs/registry.ts`
- Create: `packages/eval/src/packs/swebench-lite-30.ts` (instance ids from curated-30 JSON)
- Create: `packages/eval/src/packs/load-pack.ts` (+ tests)
- Move/copy curated JSON to `packages/runtime/bench/tasks/swebench-lite-curated-30.json` for `pnpm bench`

### Task 2: `swebench` grader + `--pack` on `eval run`

- Add `grade.type: "swebench"` to types
- Extend `run-repo-patch-task` to extract patch without hidden tests
- After suite: write `predictions.jsonl`; optionally run harness and merge `eval-report.json`
- CLI: `artificer eval run --pack swebench-lite-30 [--limit N]`

### Task 3: `llm-judge` grader (opt-in)

- Add `{ type: "llm-judge", rubric: string }`
- `runIdentityEval` refuses unless `options.llmJudge` or `ARTIFICER_EVAL_LLM_JUDGE=true`
- CLI `--llm-judge`; injectable complete fn for tests

### Task 4: CI recipe + docs

- Create: `evals/examples/github-eval.yml`
- Update: `docs/guides/agent-evals.md`
