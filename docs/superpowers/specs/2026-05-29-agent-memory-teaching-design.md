# Agent Memory & Teaching — Design

**Date:** 2026-05-29
**Status:** Approved (pending spec review)
**Component:** `packages/runtime`, `apps/runtime-ui`

## Goal

Let a person teach the agent by sending it **links or content** through the normal
message channel. The agent reads/digests the material and stores durable,
recallable knowledge in its memory, so it can apply what it has learned later.

## Background — what exists today

- `Memory` type: `{ id, content, tags[], createdAt }`, persisted one-JSON-per-file
  under `data/memories/`.
- `Store` methods: `addMemory(content, tags)`, `listMemories()`,
  `searchMemories(query)` (naive substring/tag `includes` over every memory).
- Tools `add_memory` and `query_memories` are available to the communicator,
  planner, and worker roles.
- Memories are **not** injected into any prompt — a role only recalls them if it
  explicitly calls `query_memories`.
- There is **no** way to fetch a URL. The communicator has only
  reply / start_workstream / send_note / get_status / query_memories / add_memory
  (no shell, no web access).
- Roles are spawned via `engine.spawnCall({ role, description, ... })`, where
  `role` is one of `communicator | orchestrator | planner | reviewer | worker`.
  Calls can run without a workstream (`workstreamId` is optional).

## Decisions (from brainstorming)

1. **Entry point:** the normal message channel. The communicator recognizes
   teaching intent (a link, pasted reference material, "remember this", "read this
   and learn it").
2. **Processing:** a dedicated **async "librarian" call** (approach A). The
   communicator kicks it off in the background on a more capable model and replies
   immediately; the librarian fetches, distills, and saves, then reports back.
3. **Recall/ranking:** **keyword/lexical only** for now — no new providers, fully
   local. Ranking lives behind a single function so semantic embeddings could
   replace it later without reworking callers.
4. **Injection strategy:** **pull-only** — memories stay OUT of prompts; a role
   recalls them on demand via `query_memories`. Plus a cheap **signpost** line in
   context so the agent knows it *has* memory worth querying.
5. **UI:** ship a **Memories page** now in `runtime-ui`.

## Architecture

```mermaid
flowchart TD
  U[User message: link or content] --> C[Communicator]
  C -->|teaching intent| L[learn tool -> spawnCall role=librarian]
  C -->|reply| U
  L --> LB[Librarian call - background, medium tier]
  LB -->|if URL| F[fetch_url tool]
  F --> LB
  LB -->|dedupe| Q[query_memories]
  LB -->|save facts| A[add_memory -> Memory file + index.json]
  LB -->|reply 'here is what I learned'| U
  subgraph Recall (any role, on demand)
    R[query_memories] --> IDX[index.json rank] --> FULL[load top-k full files]
  end
```

### 1. Memory storage model

Enrich `Memory` (all new fields optional → existing files still parse):

```ts
interface Memory {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  // new, optional:
  title?: string;       // short label
  summary?: string;     // one-line gist
  source?: string;      // URL, or "conversation"
  kind?: 'note' | 'document';
  updatedAt?: string;
}
```

- One JSON file per memory remains the **source of truth**
  (`memories/<createdAt>-<id>.json`).
- Add a lightweight **`memories/index.json`**: an array of
  `{ id, title, tags, summary, source, createdAt }`. Updated on every write.
  Ranking/search reads this small index; only the top matches load their full
  content file. This keeps recall fast and bounded as memory grows — no database.
- If `index.json` is missing or stale, it is rebuilt from the per-memory files
  (self-healing).

### 2. Retrieval — pull-only, keyword

- Replace the naive `searchMemories` with a ranked search:
  - A pure `rankMemories(query, entries)` function scores index entries by
    word/tag overlap (case-insensitive, simple token overlap + tag boost).
  - `query_memories(query, { tags?, limit? })`: filter by optional `tags`, rank,
    return the **top `limit` (default 5)** within a **character budget**
    (e.g. ~4k chars) — never the whole store. Each result shows title/tags/source
    + content and its `id`.
  - Empty-query "list everything" is also capped (returns a budgeted, ranked-by-
    recency slice, not the full store).
- Ranking is isolated in one function so an embeddings-based ranker can be
  swapped in later with no caller changes.

### 3. Signpost (the pull-only mitigation)

Add one line to `buildContext` (`engine/call.ts`), e.g.:

> "You have 42 memories (topics: python, deploy, prefs, …). Use `query_memories`
> to recall anything relevant before answering."

- Derived cheaply from `index.json` (count + distinct top tags, capped list).
- Contains **no memory content** — just a signpost so the agent knows it's worth
  querying. Replaces the existing static "you can use query_memories" hint.

### 4. Librarian ingestion (approach A)

- **`fetch_url` tool** (new): uses Node's global `fetch`. GET the URL, strip
  `<script>`/`<style>` and tags to readable text, collapse whitespace, cap to
  ~50k chars (note truncation), extract `<title>`. Returns title + text. Clear
  error message on bad URL / non-200 / network/timeout. No new dependencies.
- **`librarian` role** (new): tools `fetch_url`, `add_memory`, `query_memories`,
  `reply`. System prompt:
  - If given a URL, `fetch_url` it; if given raw content, use it directly.
  - Extract the **durable, teachable** facts (skip transient/navigational fluff).
  - `query_memories` first to avoid duplicates.
  - Save each fact as a focused memory with `title`, `tags`, `summary`, and
    `source`.
  - `reply` with a short summary of what was learned.
  - Wire into `RoleName`, `roles.ts`, `registry.ts`, and model-tier config
    (default **medium**; `DEFAULT_ROLE_TIER.librarian = 'medium'`).
- **Communicator routing:**
  - New `learn` tool: `spawnCall({ role: 'librarian', description: <material/url +
    instruction>, originMessageId: run.originMessageId, parentRunId: run.id })`.
  - Update the communicator prompt: a link, pasted reference material, or "remember
    this / read this and learn it" → call `learn`, then `reply` "on it, learning
    now." (Distinct from `start_workstream`, which is for doing work.)

### 5. UI — Memories page (now)

- **`GET /memories`** endpoint: returns `listMemories()` (newest first). Optional
  `?q=` runs the ranked search.
- **Memories page** in `runtime-ui` (`/memories`, nav entry): list entries
  (title, content, tags, source as a link when it's a URL, created/relative time),
  newest first, with a search box that calls `GET /memories?q=`. New react-query
  hook `useMemories(q?)` polling ~5s. Librarian runs already surface in `/usage`
  and the message call tree.

## Error handling

- `fetch_url` failure → librarian reports it in its `reply`, saves nothing.
- Dedup: librarian calls `query_memories` before `add_memory`.
- `index.json` missing/corrupt → rebuild from per-memory files.
- Oversized content → truncated with an explicit note in the fetched text.

## Testing

- **Unit:** HTML→text + truncation in `fetch_url`; `rankMemories` ordering and the
  budget/limit cap in `query_memories`.
- **Manual e2e:** send a URL through the UI → watch the librarian run in the call
  tree → confirm new memories on the Memories page → in a later message confirm the
  signpost appears and `query_memories` recalls the taught facts.

## Out of scope

- Semantic/embeddings recall (designed to be pluggable later, not built now).
- Auto-injecting memory **content** into prompts (pull-only by decision).
- Memory editing/deletion UI, memory expiry/decay, multi-user namespaces.
- Authn/z, SSE (UI continues to poll).
