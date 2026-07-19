# Managing Memories

Memories are markdown files the agent writes to `identity/memories/` as it works. They are the agent's long-term notes — things it wants to remember across conversations. Because they live in the identity repo, they are git-tracked and come along when you clone or move the agent.

## Where memories live

```
my-agent/
└── identity/
    ├── index.json              ← search index (rebuilt automatically)
    ├── graph.json              ← links between memories (rebuilt on write)
    ├── embeddings.json         ← optional; only when embeddings are enabled
    └── memories/
        ├── team-context.md     ← seeded manually
        └── deployment-notes.md ← written by the agent
```

Memories are plain markdown files with a YAML front matter block containing the memory's id, title, summary, tags, kind, source, optional related links, and timestamps. The agent rebuilds `identity/index.json` and `identity/graph.json` every time a memory is written, updated, or deleted. That index is used on both write and query (and self-heals if it goes missing or drifts from the files on disk). Dangling related edges (targets deleted) are dropped at query time and garbage-collected from the index/graph on the next rebuild.

## Signpost (passive hint)

Each role call gets a short **signpost** in context — a count of memories and the top tags, with no memory content. When identity storage is configured, the signpost is built from `identity/index.json` (not the ephemeral exec store). Content is never auto-injected; the agent must call `query_memories` to recall details.

## How the agent writes memories

The agent writes memories using the built-in `add_memory` tool. It is available to the `worker`, `planner`, `communicator`, and `librarian` roles. The agent decides what is worth remembering — recurring context, decisions made, preferences learned — and calls `add_memory` with a content body, optional title, tags, kind (`note`, `document`, `preference`, `claim`, or `entity`), and optional `related` links to other memories.

Each memory is stored as a file under `identity/memories/` with a generated id like `note_a1b2c3d4.md`. The file is written immediately and the index is rebuilt in place.

## Auto-commit and auto-push

By default the agent writes memory files and leaves them as untracked changes. If you enable `autoCommit` in `artificer.config.json`, the runtime commits each write to the identity repo automatically:

```json
{
  "name": "Atlas",
  "identity": {
    "autoCommit": true,
    "autoPush": false,
    "commitPrefix": "memory:"
  }
}
```

With `autoPush: true` the runtime also does a `git pull --rebase` followed by `git push` after each commit. The default commit message format is `memory: add <id>`, `memory: update <id>`, or `memory: delete <id>`.

## Workstream chronicles and distillation

Each workstream gets a `document` memory (the **chronicle**) that accumulates Goal, Plan, Worker, Review, and Outcome sections. Chronicles are capped at **32 KiB**: when they grow past that, older middle sections are dropped and a short rollup note is inserted. Goal and the newest sections are kept.

When a workstream finishes (`done`, `failed`, or `cancelled`), the runtime — by default — spawns a fire-and-forget **librarian distill** that extracts 1–5 `claim` memories (and optional `entity` memories) linked back to the chronicle with `related` / `builds_on`. Distill failures only log; they never block the workstream. Re-distill is skipped when the goal+summary+status hash is unchanged. The chronicle also records `sourceHash` (and `sourceCommit` when a git HEAD is available); `query_memories` may footnote soft freshness (`fresh` / `stale` / `unknown`) — never blocking.

Disable distillation with:

```json
{
  "identity": {
    "distillWorkstreams": false
  }
}
```

### Optional embeddings (better meaning-based search)

By default, memory search matches **words** in titles, tags, summaries, and short excerpts (including close spellings). That works well when the query and the memory share the same terms.

**Embeddings** are optional. When you turn them on, Artificer also stores a numeric fingerprint of each memory in `identity/embeddings.json`. At search time it compares the query’s fingerprint to those fingerprints, then **combines** that with the normal word-based ranking. The upside: a query like “auth tokens” can still surface a memory titled “JWT session signing” even when the exact words differ. Embeddings are off by default so agents stay offline-friendly and cheap to run.

#### Local provider (no API key)

Use this when you want meaning-aware search without calling a cloud API. Vectors are built on the machine with Artificer’s built-in hasher — no network, no cost.

Add this to `artificer.config.json`:

```json
{
  "name": "Atlas",
  "identity": {
    "autoCommit": true,
    "embeddings": {
      "enabled": true,
      "provider": "local"
    }
  }
}
```

What happens next:

1. Restart (or start) the agent so the config loads.
2. The next time a memory is created or updated, Artificer writes/updates that memory’s vector in `identity/embeddings.json`.
3. `query_memories` uses word matching **and** fingerprint similarity, then returns the same Matched / Related / Notes shape as before.

If you use `identity.autoCommit`, `embeddings.json` is included when Artificer commits under `identity/` (same as `index.json` and `graph.json`).

To turn embeddings off again, set `"enabled": false` or remove the `embeddings` block and delete `identity/embeddings.json` if you no longer want the file around.

#### Remote provider (`openai`)

Use this when you want the config shaped for a hosted embedding model. Set `provider` to `"openai"`, optionally name a `model`, and put an API key in the environment.

`artificer.config.json`:

```json
{
  "name": "Atlas",
  "identity": {
    "autoCommit": true,
    "embeddings": {
      "enabled": true,
      "provider": "openai",
      "model": "text-embedding-3-small"
    }
  }
}
```

Environment (pick one):

```bash
# .env next to the agent, or your process environment
export OPENAI_API_KEY=sk-...

# or, if you already use Artificer's LLM key env:
export LLM_API_KEY=sk-...
```

Notes for the remote path:

- Requires `OPENAI_API_KEY` or `LLM_API_KEY`. Without a key, embedding writes are skipped and search stays word-based.
- When keys **are** set, Artificer calls the OpenAI embeddings API (default model `text-embedding-3-small`, overridable via `model`) and stores vectors in `identity/embeddings.json`.
- Word-based search always remains available. If embeddings are missing, empty, or cover too few memories, Artificer falls back to word matching alone.

#### Choosing a provider

| Goal                     | Config                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| Simplest / offline       | `"provider": "local"`                                                |
| Hosted OpenAI embeddings | `"provider": "openai"` + `model` + `OPENAI_API_KEY` or `LLM_API_KEY` |
| Explicitly off           | omit `embeddings`, or `"enabled": false`, or `"provider": "none"`    |

### Large learn jobs

For many URLs or a very large paste, the librarian can call `save_learn_batch` to write scratch JSON under the exec dir, then `finalize_learn_batches` to merge, dedupe entities, normalize kinds (`decision` → `claim`), and `add_memory` once per final item. Reply content stays short; intermediates are deleted after success.

## How memories are searched

When a role calls `query_memories`, the runtime searches the identity index (when configured). The search:

1. Optionally filters candidates by tag **before** ranking (OR match: any requested tag present).
2. Tokenizes the query: lowercased, split on non-alphanumerics, stopwords removed, single-character tokens dropped.
3. Scores candidates with weighted fuzzy matching (Fuse.js) over index fields:
   - `title` — weight 0.4
   - `tags` — weight 0.3
   - `summary` — weight 0.2
   - `excerpt` — weight 0.1 (first ~200 characters of the body; ranking only)
4. Adds a tag-token boost (+3 per query token that appears in the memory's tags), so tag hits outrank title-only spam.
5. Multi-token queries are OR'd (any token can match). Threshold ~0.4; near-miss / partial titles still rank.
6. Returns the top matches within a character budget (default **4000**). The #1 hit is always included and truncated if it alone exceeds the budget.
7. Expands **1-hop related** neighbors (forward and reverse edges) into a Related section, preferring `claim` / `preference` neighbors over long `document`s, still within the remaining char budget.

An empty query (or a query made entirely of stopwords) returns candidates in recency order (still subject to tag filter, limit, and char budget).

Results are capped at the requested limit (default 5 when called by the agent tool; the store API defaults to 10).

### Kinds and related links

| Kind         | Purpose                                 |
| ------------ | --------------------------------------- |
| `note`       | Atomic fact from conversation           |
| `document`   | Distilled source / workstream chronicle |
| `preference` | Standing instruction                    |
| `claim`      | Distilled assertion / decision          |
| `entity`     | Named person/tool/repo/org              |

Optional frontmatter `related` links memories with typed edges (`related`, `builds_on`, `contradicts`, `cites`, `categorized_under`). Unknown target ids are dropped on write with a warning.

## Seeding initial memories

You can pre-populate the agent's memory before it starts by adding markdown files to `identity/memories/`. This is the recommended way to give the agent standing context it should always have:

```bash
# Create a memory file
cat > identity/memories/team-context.md << 'EOF'
## Team

We are the payments team at Acme Corp. Our main repos are:
- `payments-api` — Go service
- `payments-web` — React dashboard

When opening PRs, always tag @payments-reviewers.
EOF
```

Manually seeded files do not need front matter — the runtime will fall back to the filename (without `.md`) as the memory id. Adding front matter gives you control over tags and the summary used for search.

Note: `agent/instructions.md` is better for standing context the agent should always see, since it is loaded on every run. Memories are for context the agent writes itself or that should only surface when relevant.

## Committing memories manually

If you have `autoCommit` disabled (the default), memory files appear as untracked or modified files in the identity repo. Commit periodically to keep the repo clean:

```bash
cd my-agent
git add identity/
git commit -m "chore: sync agent memories"
git push
```

In production, you may want to automate this — for example, a cron job or a post-run hook.

## Viewing and editing memories

Memories are plain markdown — open them in any editor. You can edit, delete, or reorganize them freely. The agent re-reads them from disk on each run. If you edit the content of a memory file directly, the change is picked up immediately; the front matter fields are optional for manually maintained files.

## Related docs

- [Setting up an agent identity repo](./agent-identity-setup.md) — identity repo structure
- [Core concepts — memories](../getting-started/core-concepts.md#memories)
