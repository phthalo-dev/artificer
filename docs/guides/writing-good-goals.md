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
