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

Memories are plain markdown files with a YAML front matter block containing the memory's id, title, summary, tags, kind, source, and timestamps. The agent rebuilds `identity/index.json` every time a memory is written, updated, or deleted — that index is what makes search fast.

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

When a role calls `query_memories`, the runtime runs a keyword search over the index. The search:

1. Tokenizes the query: lowercased, split on non-alphanumerics, stopwords removed, single-character tokens dropped.
2. Scores each memory by counting how many query tokens appear in its title, summary, and tags combined.
3. Boosts tag matches by 3 points per matching token (compared to 1 point for a title or summary hit).
4. Returns only memories with a score above zero, sorted by score descending; ties break by recency.

An empty query (or a query made entirely of stopwords) returns all memories in recency order.

You can also filter by tag — the `query_memories` tool accepts an optional `tags` array that narrows candidates before scoring.

Results are capped at the requested limit (default 5 when called by the agent).

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
