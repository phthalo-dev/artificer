# Managing Memories

Memories are markdown files the agent writes to `identity/memories/` as it works. They are the agent's long-term notes — things it wants to remember across conversations. Because they live in the identity repo, they are git-tracked and come along when you clone or move the agent.

## Where memories live

```
my-agent/
└── identity/
    ├── index.json              ← keyword index (rebuilt automatically)
    └── memories/
        ├── team-context.md     ← seeded manually
        └── deployment-notes.md ← written by the agent
```

Memories are plain markdown files with a YAML front matter block containing the memory's id, title, summary, tags, kind, source, and timestamps. The agent rebuilds `identity/index.json` every time a memory is written, updated, or deleted. That index is used on both write and query (and self-heals if it goes missing or drifts from the files on disk).

## Signpost (passive hint)

Each role call gets a short **signpost** in context — a count of memories and the top tags, with no memory content. When identity storage is configured, the signpost is built from `identity/index.json` (not the ephemeral exec store). Content is never auto-injected; the agent must call `query_memories` to recall details.

## How the agent writes memories

The agent writes memories using the built-in `add_memory` tool. It is available to the `worker`, `planner`, `communicator`, and `librarian` roles. The agent decides what is worth remembering — recurring context, decisions made, preferences learned — and calls `add_memory` with a content body, optional title, tags, and kind (`note`, `document`, or `preference`).

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

An empty query (or a query made entirely of stopwords) returns candidates in recency order (still subject to tag filter, limit, and char budget).

Results are capped at the requested limit (default 5 when called by the agent tool; the store API defaults to 10).

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
