# @artificer-ai/runtime

## 0.11.2

## 0.11.1

## 0.11.0

### Minor Changes

- df79b42: Enforce `needsApproval` with a durable exec/identity `tool-policy.json`, structured approval errors, and HTTP CRUD at `/api/policy/rules`.
- 99aa41b: Add an `execute` tool for worker and orchestrator that runs a bounded JavaScript program to sequence and concurrently call existing tools in one model turn.
- 07156ef: Replay byte-identical `buildContext` section bodies when content is unchanged so consecutive workstream role calls can hit the prompt cache.
- d6c4aa0: Add `artificer import-history` to seed preference memories from Claude Code, Cursor, Codex, and OpenCode session logs.
- e5364be: Add human-readable workstream receipts: deterministic JSON/Markdown delivery records, a receipt API and UI tab, compact Slack/Discord completion replies, and an optional receipt summarizer role for polished summaries.

### Patch Changes

- 6374dd4: Fix memory gap follow-ups: pass repo HEAD for freshness, pack related claim bodies within budget, call real OpenAI embeddings when configured, align query_memories defaults, age out learn scratch dirs, and surface related/source metadata in the API and UI.
- ed89882: Pick prior-run digest size from the active model family (GPT-5 compact earlier, Gemini keep more history) instead of a fixed 8-run window, with `RUNTIME_COMPACTION_PROFILE` for bench A/B.

## 0.10.0

### Minor Changes

- b03a88a: Improve identity memory recall: accurate signpost, tag-before-rank query with char budget, and fuzzy weighted ranking via Fuse.js.
- 08a9a7e: Add claim/entity memory kinds, typed related edges with graph.json, and 1-hop packed query results.
- 7a90291: Distill finished workstreams into claim memories, trim oversized chronicles, and add an identity.distillWorkstreams kill switch.
- d337125: Add memory source freshness footnotes, optional local embeddings hybrid ranking, and learn-batch scratch merge for large librarian jobs.

## 0.2.0

### Minor Changes

- dda1508: Update UI for auth and add fly.io

## 0.1.1

### Patch Changes

- updates
