# Memory Infrastructure Improvements — Design Spec

**Date:** 2026-07-18  
**Status:** Implemented  
**Component:** `packages/runtime`, `packages/ui` (docs only for UI)  
**Inspiration:** Understand-Anything wiki/knowledge pipeline patterns (claims, typed links, hop expansion, fingerprinting, intermediate-on-disk). Not adopting UA as a dependency or dashboard product.

## Goal

Improve Artificer’s durable agent memory so roles can recall **linked, typed knowledge** with better ranking and controlled context size — without abandoning git-backed markdown identity, pull-only injection, or the librarian / workstream-memory write paths.

## Problem

Identity memories today are a **flat bag of markdown files** searched by exact token overlap on title/summary/tags. Workstreams become **append-only chronicles**. Signpost and query paths still carry bugs/asymmetries from the Store → IdentityStore migration. Net effect: agents under-recall (wrong signpost, weak ranker, no neighborhood) and over-load context (no char budget on the identity path).

Research against Understand-Anything and the current runtime shows the transferable idea is not a codebase knowledge graph — it is:

1. Separate stable facts from LLM-inferred assertions
2. Store assertions as linkable atoms (`claim`) with typed edges
3. Retrieve via search → 1-hop expand → packed results with a budget
4. Distill long narratives on structural change, not on every edit

## Constraints (must preserve)

- **Git-backed identity** — memories remain ordinary files under `identity/memories/`; `IdentityGitSync` still auto-commits/pushes.
- **Pull-only injection** — no automatic injection of memory _content_ into prompts. Only a cheap signpost is passive; content arrives via `query_memories`.
- **Markdown + frontmatter** — human-editable / seedable; no opaque DB as source of truth.
- **Fire-and-forget writes** — memory / git failures never block orchestration.
- **No required cloud embedding provider** — Phase D embeddings are optional and local-or-configured; lexical search remains the default.
- **Single ranking chokepoint** — `rankMemories` (or a successor with the same call signature for callers) stays the only place scoring lives.

## Non-goals

- Adopting or vendoring Understand-Anything / `.ua/knowledge-graph.json`
- Interactive knowledge-graph dashboard as the agent memory UX
- Tree-sitter / AST fingerprints for identity notes
- Auto-injecting full memory graphs into every role prompt
- Multi-user memory namespaces, TTL/decay UI, or conflict resolution beyond existing git rebase abort

---

## Phased delivery

| Phase | Name           | Outcome                                                                                      |
| ----- | -------------- | -------------------------------------------------------------------------------------------- |
| **A** | Hygiene        | Correct signpost; identity query parity (tags before rank, char budget); better lexical rank |
| **B** | Structure      | `claim`/`entity` kinds; `related` edges; 1-hop expand on query; relationship packing         |
| **C** | Distillation   | Terminal workstreams emit claim atoms; entity dedupe; size-aware chronicles                  |
| **D** | Optional depth | Source freshness hashes; optional embeddings; intermediate batches for large `learn` jobs    |

Ship A before B; B before C. D items may land independently once A–B exist.

---

## Phase A — Hygiene

### A1. Identity-aware signpost

**Bug:** `buildContext` in `packages/runtime/src/engine/call.ts` calls `store.memorySignpost()`, which reads the ephemeral exec `Store` memories dir. Production writers use `IdentityStore`, so the signpost almost always says there are no memories.

**Change:**

1. Add `IdentityStore.memorySignpost(): Promise<string | null>` — same copy as `Store.memorySignpost` (count + top tags, no content). Implement against `listMemories()` / index entries from identity files.
2. In `buildContext`, prefer identity when present:

```ts
const signpost = engine.identity
  ? await engine.identity.memorySignpost()
  : await store.memorySignpost();
```

(`buildContext` today only receives `store`; thread `identity?: IdentityStore` through the same way other context builders receive deps, or pass a precomputed signpost string from `call` callers that already have `engine`.)

**Tests:** With only identity memories present, context includes `You have N memories…`, not the empty fallback.

### A2. Identity `queryMemories` parity

**Bugs / asymmetries:**

- Identity ranks then post-filters tags in the tool handler → can under-return vs limit.
- Identity has no `charBudget` (Store defaults to 4000).
- Identity rebuilds/score from full `listMemories()` and never reads `index.json` on query (index is write-only today).

**Change — `IdentityStore.queryMemories`:**

```ts
async queryMemories(
  query: string,
  opts?: {
    tags?: string[];
    limit?: number;      // default 10 for store API; tool keeps its own default
    charBudget?: number; // default 4000
  },
): Promise<Memory[]>
```

Algorithm:

1. Load index entries from disk (`identity/index.json`), rebuild if missing/corrupt/count mismatch (port Store’s `readReconciledIndex` pattern).
2. If `tags` present, filter candidates **before** ranking (OR match: any requested tag present).
3. `rankMemories(query, candidates)` → take `limit`.
4. Load full files for ranked ids; accumulate content until `charBudget` would be exceeded (always include at least the top hit if it alone exceeds budget, truncated).

**Tool (`orchestrator-tool.ts`):** Always call the identity path when `engine.identity` is set, passing `{ tags, limit, charBudget }` into the store — remove the post-rank tag filter and stop relying on ephemeral `Store.queryMemories` in production.

**Tests:** Tag filter with `limit` returns up to `limit` tag-matching memories; budget truncates second+ bodies; reconciled index rebuilds after corrupt `index.json`.

### A3. Weighted / fuzzy lexical ranking

**File:** `packages/runtime/src/storage/memory-search.ts`

Keep `rankMemories(query, entries): RankedEntry[]` as the API.

Enhance scoring (still local, no new provider):

1. **Fields & weights** (Fuse-style weights adapted to our index):
   - `title` — 0.4
   - `tags` — 0.3
   - `summary` — 0.2
   - `excerpt` (new optional index field, first ~200 chars of body) — 0.1
2. Prefer a small fuzzy library (e.g. Fuse.js) **or** an in-repo fuzzy score if dependency policy forbids Fuse. Threshold ~0.4; multi-token queries OR’d (any token can match).
3. Preserve: empty / stopword-only query → recency order with `score: 0`.
4. Preserve tag boost relative to non-tag hits (document exact formula in tests).

**Index entry update:**

```ts
export interface MemoryIndexEntry {
  id: string;
  title?: string;
  summary?: string;
  excerpt?: string; // NEW — body slice for ranking only
  tags: string[];
  source?: string;
  kind?: Memory['kind'];
  related?: string[]; // Phase B — ignore in A if not present
  createdAt: string;
}
```

**Tests:** Typo / partial title still ranks above unrelated; tag boost still beats title-only; stopword query = recency.

### A4. Docs

Update `docs/guides/managing-memories.md` for: signpost source, tag-before-rank, char budget, ranking fields (title/tags/summary/excerpt).

---

## Phase B — Structure

### B1. New kinds: `claim` and `entity`

Extend `Memory.kind`:

```ts
kind?: 'note' | 'document' | 'preference' | 'claim' | 'entity';
```

| Kind         | Purpose                                        | Typical content                                                 |
| ------------ | ---------------------------------------------- | --------------------------------------------------------------- |
| `note`       | Atomic fact from conversation                  | Short prose                                                     |
| `document`   | Distilled source / workstream chronicle        | Longer markdown                                                 |
| `preference` | Standing instruction                           | Imperative rule                                                 |
| `claim`      | Distilled assertion / decision                 | 1–2 sentence assertion in `summary` + optional evidence in body |
| `entity`     | Named person/tool/repo/org without its own doc | Short description                                               |

**IDs:** Keep `${kind}_${uuid8}` (`claim_…`, `entity_…`).

**Zod / API / UI:** Allow new kinds on `POST /api/memories` and Memories page kind selector.

**Librarian & communicator prompts:** Prefer `claim` for durable assertions distilled from sources; use `entity` for named things referenced across claims/docs. Still 1–3 memories per source max unless Phase C distillation adds workstream claims.

### B2. Typed links (`related` + edge types)

**Frontmatter (per memory file):**

```yaml
related:
  - id: 'claim_abc12345'
    type: 'builds_on'
  - id: 'document_def67890'
    type: 'related'
```

Supported edge types (start small — UA knowledge set, not 38 code types):

```ts
export type MemoryEdgeType =
  | 'related'
  | 'builds_on'
  | 'contradicts'
  | 'cites'
  | 'categorized_under';
```

Defaults: if only an id string is listed historically, treat as `related`.

**Index / graph artifact:**

- `identity/index.json` entries include `related: { id, type }[]` for hop expansion without opening every file.
- Optional `identity/graph.json` rebuilt on every write for external tools / future UI:

```ts
{
  "version": "1",
  "edges": [
    { "from": "document_…", "to": "claim_…", "type": "builds_on" }
  ]
}
```

Edges are always derivable from frontmatter; `graph.json` is a convenience mirror (like today’s write-only index). Delete must rewrite graph and strip dangling inbound edges from other memories’ frontmatter (or leave dangling and drop at query time — prefer **drop at query + GC on next `rebuildIndex`** for fire-and-forget simplicity; document that deletes soft-orphan until rebuild).

**`add_memory` / `updateMemory`:** Accept optional `related: { id, type }[]`. Validate targets exist when provided; skip/drop unknown ids with a log warning (UA-style dangler drop).

### B3. Query: search + 1-hop expand + pack

**`IdentityStore.queryMemories` enrichment (or new `queryMemoriesRich` used by the tool):**

1. Rank + tag filter + load top hits as today (Phase A).
2. Collect neighbor ids from each hit’s `related` (and reverse edges from index/graph). Cap neighbors at e.g. **2× limit** (configurable constant).
3. Load neighbor bodies into remaining `charBudget`. Prefer `claim`/`preference` neighbors over long `document`s.
4. Tool response format:

```
## Matched
- {title} [tags] (kind, source)
  {content}

## Related
- {id} --[builds_on]--> {id}: {one-line summary}
…

## Notes
- Char budget: used/limit
```

Keep pull-only: this packing happens **inside the tool result**, never in `buildContext`.

**Tests:** Linked claim appears under Related when query hits the parent document; dangling edge omitted; budget prefers claims.

### B4. Prompt updates

- **Planner:** After preference query, also `query_memories` for repo/topic when known.
- **Librarian:** Emit `related` links back to existing memories when complementing; prefer `claim` for assertions.
- **Communicator:** Preferences stay `preference`; distilled lasting decisions can be `claim`.

---

## Phase C — Workstream distillation

### C1. Keep chronicle, add claims on terminal

`WorkstreamMemoryService.onTerminal` today appends outcome and sets summary. Extend:

1. Still update the workstream `document` memory (chronicle).
2. Spawn a **distiller** path (reuse librarian role or a thin `distill_workstream` spawn) with:
   - Input: workstream goal, plan excerpt, terminal summary, final chronicle path/id
   - Output: 1–5 `claim` memories + optional `entity` memories for repos/tools named
   - Each claim `related` → workstream document with `builds_on` or `related`
   - Preferences already applied during the workstream should not be re-copied; link via `related` if a preference id is known

3. Fire-and-forget; failure only logs.

**Prompt rules (borrow UA article-analyzer conservatism):**

- Do not invent links without textual evidence in the chronicle.
- Prefer fewer claims; skip fluff.
- Dedupe via `query_memories` before save.

### C2. Chronicle size guard

When appending sections, if content length exceeds a config default (e.g. **32 KiB**), truncate oldest middle sections (keep Goal + latest Plan/Worker/Review/Outcome) or replace body with a short rollup + pointer to `source: workstream:{id}`. Claims remain the primary recall units.

### C3. Deterministic vs LLM split

| Deterministic (runtime)                                      | LLM (distiller)                       |
| ------------------------------------------------------------ | ------------------------------------- |
| Tags (`workstream`, status, repo slug), `source`, timestamps | Claims, entity names, `related` edges |
| Content hash of goal+summary for skip-if-unchanged           | Summaries / phrasing                  |

If `sourceHash` (Phase D) matches previous terminal distill, skip re-distill.

---

## Phase D — Optional depth

### D1. Source freshness

Add optional frontmatter:

```yaml
sourceHash: '<sha256 of source bytes or workstream snapshot>'
sourceCommit: '<git sha if applicable>'
```

Surfacing:

- Signpost or query footnote: `stale` when workstream repo `HEAD` ≠ `sourceCommit` (best-effort; `unknown` if git unavailable — do not claim fresh).
- Soft warning string in tool output only; never block.

### D2. Optional embeddings

- Store vectors **beside** markdown, e.g. `identity/embeddings.json` keyed by memory id → `number[]`, regenerated on write when an embedding provider is configured.
- Config (schema):

```json
"identity": {
  "embeddings": {
    "enabled": false,
    "provider": "openai" | "local" | "none",
    "model": "…"
  }
}
```

- Ranking: if embeddings present for enough candidates, score with cosine similarity and **fuse** with lexical ranks (reciprocal rank fusion or simple average of normalized ranks). If disabled or empty, lexical-only (Phase A).
- `rankMemories` gains an optional second stage or a sibling `rankMemoriesHybrid` called only from `IdentityStore` when embeddings enabled — callers of the pure lexical function stay unchanged for unit tests.

### D3. Intermediate batches for large `learn` jobs

When librarian receives many URLs or a very large paste:

1. Write scratch under exec dir: `{exec}/tmp/learn-{runId}/batch-*.json` (facts extracted per batch).
2. Return only a short summary to the LLM turn.
3. Merge batches deterministically: normalize kinds (`decision`→`claim` aliases), entity-name dedupe (case-insensitive), drop dangling `related`, then `add_memory` once per final item.
4. Trash intermediates after success (or age out).

Do not put large JSON in the librarian reply content.

---

## Data model (target)

```
identity/
  index.json          # MemoryIndexEntry[] — now used on read + write
  graph.json          # optional edge mirror (Phase B)
  embeddings.json     # optional (Phase D)
  memories/
    claim_….md
    entity_….md
    document_….md
    preference_….md
    note_….md
```

**Frontmatter (full):**

```yaml
---
id: 'claim_a1b2c3d4'
title: 'Payments uses TDD'
summary: 'Always write failing tests before implementation in the payments repo.'
tags: ['claim', 'payments']
kind: 'claim'
source: 'workstream:ws_…'
related:
  - id: 'document_…'
    type: 'builds_on'
sourceHash: '…'
sourceCommit: '…'
createdAt: '…'
updatedAt: '…'
---
Evidence / elaboration…
```

---

## Implementation map

| Area       | Files                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Types      | `packages/runtime/src/storage/types.ts`, `memory-search.ts`                                        |
| Store      | `identity-store.ts`, `identity-git-sync.ts` (commit `graph.json` / `embeddings.json` when present) |
| Context    | `engine/call.ts` (+ signature changes for identity)                                                |
| Tools      | `tools/orchestrator-tool.ts`                                                                       |
| Workstream | `engine/workstream-memory.ts`, `engine/engine.ts`, `roles.ts`                                      |
| API        | `server/app.ts` createMemorySchema kind enum                                                       |
| Config     | `artificer.config.schema.json`, `config.ts`                                                        |
| UI         | `MemoriesPage` kinds, related, sourceHash/sourceCommit                                             |
| Docs       | `docs/guides/managing-memories.md`, this spec                                                      |

---

## Testing plan

### Phase A

- [x] Signpost with identity-only memories reports correct count/tags
- [x] Tag filter before rank respects `limit`
- [x] Char budget truncates without dropping the #1 hit entirely
- [x] Index reconciles after corrupt `index.json`
- [x] Fuzzy/weighted rank prefers near-miss titles over unrelated exact token elsewhere

### Phase B

- [x] `claim`/`entity` round-trip via API + tools
- [x] `related` persisted and appears in index/graph
- [x] Query packs 1-hop claims within budget
- [x] Delete drops/orphans edges without crashing

### Phase C

- [x] Terminal workstream creates ≥1 claim linked to chronicle (mocked LLM or distilled fixture)
- [x] Oversized chronicle is truncated / rolled up
- [x] Distill failure does not fail workstream

### Phase D

- [x] Stale `sourceCommit` adds soft warning in query output
- [x] Embeddings disabled → identical to lexical path
- [x] Large learn writes batch files then merges; reply stays short

---

## Rollout

1. Land Phase A behind no flags (bugfixes + ranking).
2. Phase B: new kinds and frontmatter are backward compatible (absent `related` = isolated nodes).
3. Phase C: enable distillation by default once librarian-style spawn is reliable; allow `identity.distillWorkstreams: false` kill switch.
4. Phase D: off by default (`embeddings.enabled: false`); document ops cost.

---

## Success criteria

- Roles with identity memories always see an accurate signpost.
- `query_memories` with tags returns useful preference/claim hits without silent under-count.
- After a finished workstream, a later planner can recall **short claims** tied to that work, not only a keyword-hit on a long chronicle.
- Context size from memory tools stays bounded by `charBudget`.
- Identity remains reviewable in git as markdown.

---

## References

- `docs/superpowers/specs/2026-05-29-agent-memory-teaching-design.md` — pull-only + librarian + pluggable ranker
- `docs/superpowers/specs/2026-06-25-memory-management-design.md` — IdentityStore API migration
- `docs/superpowers/specs/2026-06-25-workstream-memory-design.md` — chronicle lifecycle
- `docs/superpowers/specs/2026-06-25-memory-git-sync-design.md` — auto commit/push
- External: Understand-Anything `understand-knowledge` skill, `article-analyzer` agent, Fuse + 1-hop chat packing patterns (local sibling checkout)
