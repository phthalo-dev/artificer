# Context Section Diffs (WorldState-lite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make volatile `buildContext` sections hash-stable across consecutive workstream role calls by replaying byte-identical bodies when content is unchanged, improving prompt-cache hit rates.

**Architecture:** `context-sections.ts` owns section ids, hashing, load/save of `workstreams/<id>/context-sections.json`, and `renderSection(id, compute)`. `buildContext` routes WORK_ROLES sections through it and appends an end footer listing updated vs all-unchanged.

**Tech Stack:** TypeScript ESM, Node `crypto` for SHA-256, Node `node:test`.

**Spec:** [docs/superpowers/specs/2026-08-25-context-section-diffs-design.md](../specs/2026-08-25-context-section-diffs-design.md)

## Global Constraints

- WORK_ROLES only (`planner` / `worker` / `reviewer`); no workstreamId → no file IO.
- When hash matches, replay **exact previous body** (do not replace with “unchanged” stub).
- Footer is not part of hash inputs; it sits at the end of the user message.
- Best-effort file writes — failure logs a warning, never fails the run.
- No new LLM summarization; no plan.md injection.
- Section formatters must be deterministic (no `Date.now()` inside section bodies).

## File map

| File | Responsibility |
|---|---|
| `packages/runtime/src/engine/context-sections.ts` | Ids, hash, store, render |
| `packages/runtime/src/storage/layout.ts` | `contextSectionsFile(workstreamId)` |
| `packages/runtime/src/engine/call.ts` | Use render helpers inside `buildContext` |
| Tests | `context-sections.test.ts`; adjust `call` tests if any assert full context strings |

---

### Task 1: Section store + hash + render helper

**Files:**
- Create: `packages/runtime/src/engine/context-sections.ts`
- Modify: `packages/runtime/src/storage/layout.ts`
- Test: `packages/runtime/src/engine/context-sections.test.ts`

**Interfaces:**
```ts
export type ContextSectionId =
  | 'findings'
  | 'recent_tasks'
  | 'git_status'
  | 'prior_runs'
  | 'file_cache'
  | 'memory_signpost';

export type ContextSectionSnapshot = {
  hash: string;
  body: string;
  updatedAt: string;
};

export type ContextSectionsFile = {
  version: 1;
  sections: Partial<Record<ContextSectionId, ContextSectionSnapshot>>;
};

export function shortHash(body: string): string; // sha256 hex slice 0..16

export function loadContextSections(filePath: string): ContextSectionsFile;
export function saveContextSections(filePath: string, file: ContextSectionsFile): void;

export function renderSection(args: {
  id: ContextSectionId;
  filePath: string;
  compute: () => string | Promise<string>;
  now?: () => string; // injectable ISO timestamp for tests
}): Promise<{ body: string; updated: boolean }>;

export function formatSectionsFooter(updatedIds: ContextSectionId[]): string;
// updatedIds empty → "[context sections: all unchanged]"
// else → "[context sections updated: a, b]"
```

- [ ] **Step 1: Failing tests**
  ```ts
  test('renderSection replays exact body when hash matches', async () => {
    let computes = 0;
    const filePath = path.join(tmpdir, 'context-sections.json');
    const first = await renderSection({
      id: 'findings',
      filePath,
      compute: () => {
        computes++;
        return 'FINDINGS\n- a';
      },
      now: () => '2026-01-01T00:00:00.000Z',
    });
    assert.equal(first.updated, true);
    const second = await renderSection({
      id: 'findings',
      filePath,
      compute: () => {
        computes++;
        return 'FINDINGS\n- a';
      },
    });
    assert.equal(second.updated, false);
    assert.equal(second.body, first.body);
    assert.equal(computes, 2); // compute still runs to produce hash input
  });

  test('changed body updates store', async () => { /* ... */ });

  test('corrupt file recomputes', async () => { /* write "not-json"; expect recompute */ });

  test('formatSectionsFooter', () => {
    assert.equal(formatSectionsFooter([]), '[context sections: all unchanged]');
    assert.equal(
      formatSectionsFooter(['git_status', 'findings']),
      '[context sections updated: git_status, findings]',
    );
  });
  ```

  Note: compute always runs (spec: hash of fresh compute); replay replaces returned body when hash matches. Assert `computes === 2` on replay path.

- [ ] **Step 2: Implement** — on save failure `console.warn` and continue.

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): add hash-stable context section store

EOF
)"
```

---

### Task 2: Wire `buildContext`

**Files:**
- Modify: `packages/runtime/src/engine/call.ts`
- Test: add `call` context test or extend existing engine tests if feasible with temp store

**Steps:**

- [ ] **Step 1:** For WORK_ROLES with `workstreamId`, resolve `filePath = store.layout.contextSectionsFile(workstreamId)`.

- [ ] **Step 2:** Replace inline section assembly with sequential `renderSection` calls for the six ids, collecting `updatedIds`.

- [ ] **Step 3:** Append `formatSectionsFooter(updatedIds)` at end of the workstream context block.

- [ ] **Step 4:** Ensure findings/git/prior_runs helpers sort deterministically (fix any `Date.now()` or unstable Object key order in those formatters if present).

- [ ] **Step 5: Manual/integration assertion** — two `buildContext` calls with unchanged store fixtures produce identical section substrings (footer may say all unchanged).

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): use context section diffs in buildContext

EOF
)"
```

---

### Task 3: Docs note

- [ ] One short note in runtime architecture / contributing or `docs/reference/` — section formatters must stay deterministic.

- [ ] Commit

```bash
git commit -m "$(cat <<'EOF'
docs: note hash-stable context section invariant

EOF
)"
```

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Section ids + file format | 1 |
| Byte-identical replay | 1 |
| Footer | 1–2 |
| Wire buildContext | 2 |
| Best-effort save | 1 |
| Determinism | 2 |
| Docs | 3 |
