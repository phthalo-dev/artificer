# Gathering Evidence

Adapted from superpowers:systematic-debugging (Phase 1) and brainstorming (exploration). Use when researching before decisions.

## Iron law

Find primary sources. Cite file:line or URLs — not hearsay from summaries.

## Process

1. **Start from the question** — what decision or design does this research inform?
2. **Search systematically** — grep/glob for patterns, read_file for implementations, fetch_url for external docs.
3. **Trace data flow** — when investigating behaviour, follow calls from entry point to the relevant logic.
4. **Compare examples** — find similar working code in the repo; note differences.
5. **Synthesize** — separate facts from inference; flag open questions.

## Output format

- Key findings with file:line references
- Relevant external docs or APIs
- Recommendations ranked by confidence
- Open questions that need a planner or orchestrator decision

## Do not

- Implement changes — research only
- Speculate without labeling it as inference
- Dump raw file contents — extract the relevant snippets
