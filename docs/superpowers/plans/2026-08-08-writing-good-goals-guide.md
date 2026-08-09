# Writing Good Goals Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a docs guide that coaches a person sending a message to Artificer on how to phrase a workstream goal so the planner/worker/reviewer loop produces a good result on the first pass, and link it from the README's guide list.

**Architecture:** One new markdown file under `docs/guides/`, following the existing guide format (`docs/guides/writing-custom-tools.md`, `docs/guides/managing-memories.md`). No code changes. The content translates lessons already enforced in the planner/worker system prompts (`packages/runtime/src/engine/workstream-machine.ts`, `packages/runtime/src/engine/roles.ts`) into person-facing advice, plus the specific/testable-criteria and phased-goal lessons from Ralph Wiggum-style agent loops.

**Tech Stack:** Markdown only.

## Global Constraints

- Match the existing guide voice: direct, second person, short sections with a code block or example where useful — see `docs/guides/writing-custom-tools.md` for tone.
- No placeholder sections. Every example goal shown must be a complete, realistic example (not "e.g. some goal").
- The only other file changed is `README.md`'s guide list (one link, same list format as the existing six guide links on that line).
- There is no docs link-checker in CI (verified: no `lint:docs` script, no docs step in `.github` workflows), so verification is manual: confirm the file renders as valid markdown and the added link's relative path resolves.

---

### Task 1: Write the guide content

**Files:**
- Create: `docs/guides/writing-good-goals.md`

**Interfaces:**
- Consumes: nothing (standalone docs file).
- Produces: a markdown file linked from `README.md` (Task 2) and cross-linked from `docs/introduction/how-it-works.md`'s "Next steps" list is optional and out of scope — keep this plan's footprint to the new file plus the README link.

- [ ] **Step 1: Write the file**

```markdown
# Writing Good Goals

The words you send Artificer become the workstream's `goal` — the single string the planner, worker, and reviewer all work from. A vague goal produces a vague plan; a specific one produces a plan the worker can execute without guessing. This guide covers what makes a goal specific enough to act on.

## Give a concrete, testable definition of done

The planner maps every distinct requirement in your goal to a specific file and change, and the reviewer only approves when there's concrete evidence of success — so a goal that never states what "success" looks like forces both to guess.

❌ Vague:
> Make the login flow better.

✅ Specific:
> Fix the login redirect bug: after a successful login, users land on `/dashboard` instead of staying on `/login`. Verify with `pnpm test -- auth/login.test.ts`.

The second version gives the planner a root cause to look for and gives the worker (and reviewer) an exact command to run before calling the change done. If your project has no automated test for the behavior, say how a person would check it manually ("visiting `/login` after auth should redirect within one page load") — the reviewer will still run what it can and note the rest.

## Cover the full behavior, not just the headline

Workers are instructed to implement "the FULL described behaviour ... not just the headline case" — but they can only do that if the goal states the full behavior. Asides matter:

❌ Drops a requirement in a subordinate clause the planner won't weight:
> Add CSV export to the reports page (also should work for the filtered view).

✅ States every case as its own sentence:
> Add CSV export to the reports page. The export must include the currently applied filters — exporting from a filtered view should only include the filtered rows, not the full dataset. Add a test that filters to one category and asserts the exported CSV only contains that category's rows.

## Phase large asks

A goal that describes a whole feature as one paragraph forces the planner to invent an ordering. If you already know the right order, say so — the planner will follow it and the orchestrator will dispatch workers phase by phase instead of guessing at task boundaries.

✅ Phased:
> Build a comments feature for blog posts, in this order:
> 1. Data model and migration for a `comments` table (post_id, author, body, created_at).
> 2. API endpoints: `POST /posts/:id/comments` and `GET /posts/:id/comments`.
> 3. UI: a comment list and a submit form on the post page.
> Each phase should have its own passing tests before moving to the next; run `pnpm test` to verify.

## Name exact locations when you already know them

If you know which file or module owns the behavior, say so — it saves the planner an investigation pass:

✅
> The rate limiter in `packages/runtime/src/api/rate-limit.ts` allows 100 req/min per IP; change it to be configurable via a `RATE_LIMIT_PER_MIN` env var, default 100.

## Let the loop retry before you intervene

Artificer's workstream loop already re-runs a rejected task and detects when a worker is thrashing (repeating the same edit, or making no progress) — it blocks and reports back to you automatically rather than looping forever. You generally don't need to babysit each step. Reach for a steering note (`send_note` from chat) only when the workstream is heading in a direction you know is wrong, not to nudge every intermediate step — see [How it works](../introduction/how-it-works.md) for what happens between your message and a finished result.

## Quick checklist

Before sending a non-trivial goal, check it states:

- [ ] What "done" looks like, ideally with a command or observable behavior to verify it
- [ ] Every case the behavior must cover, each as its own sentence
- [ ] An order, if the work has natural phases
- [ ] Known file/module locations, if you have them
```

- [ ] **Step 2: Render and proofread**

Open the file in a markdown previewer (or `glow docs/guides/writing-good-goals.md` / your editor's preview) and confirm: headings render correctly, both code blocks render as fenced blocks, the checklist renders as checkboxes, and the relative link `../introduction/how-it-works.md` is correct relative to `docs/guides/writing-good-goals.md` (resolves to `docs/introduction/how-it-works.md`, which exists).

- [ ] **Step 3: Commit**

```bash
git add docs/guides/writing-good-goals.md
git commit -m "docs: add writing-good-goals guide"
```

---

### Task 2: Link the guide from the README

**Files:**
- Modify: `README.md:77`

**Interfaces:**
- Consumes: `docs/guides/writing-good-goals.md` from Task 1 (file must exist before this task's link is valid).
- Produces: nothing consumed by later tasks — this plan has two tasks total.

- [ ] **Step 1: Add the link to the guides list**

Current line 77 in `README.md`:

```markdown
- Guides: [agent identity setup](docs/guides/agent-identity-setup.md), [Slack & Discord](docs/guides/slack-discord-connections.md), [custom tools](docs/guides/writing-custom-tools.md), [custom channels](docs/guides/writing-custom-channels.md), [managing memories](docs/guides/managing-memories.md), [custom CLI executors](docs/guides/custom-cli-executor.md), [deploying to production](docs/guides/deploying-to-production.md)
```

Replace with (adds "writing good goals" right after "agent identity setup", since it's the guide most people need first):

```markdown
- Guides: [agent identity setup](docs/guides/agent-identity-setup.md), [writing good goals](docs/guides/writing-good-goals.md), [Slack & Discord](docs/guides/slack-discord-connections.md), [custom tools](docs/guides/writing-custom-tools.md), [custom channels](docs/guides/writing-custom-channels.md), [managing memories](docs/guides/managing-memories.md), [custom CLI executors](docs/guides/custom-cli-executor.md), [deploying to production](docs/guides/deploying-to-production.md)
```

- [ ] **Step 2: Verify the link resolves**

```bash
test -f docs/guides/writing-good-goals.md && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: link writing-good-goals guide from README"
```

## Self-Review Notes

- **Spec coverage:** guide covers all four gap-analysis points from the Ralph Wiggum research (specific/testable criteria, full-behavior coverage, phasing, and "don't over-supervise the loop") — confirmed against Task 1 content.
- **Placeholder scan:** all examples are complete, concrete goal text — no "e.g. something" placeholders.
- **Type consistency:** N/A (no code).
