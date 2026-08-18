# Artificer vs. Grok Bot (Cursor) — Reading Notes (2026-08-17)

> Source: a single first-person blog post (X article, `mattyp`, 2026) about Grok Bot, a Cursor product for general knowledge work — "an agent with a computer" (persistent cloud Linux VM, browser/app/filesystem access, memory, scheduling, multi-bot composability). No source-code access — this is inference from product marketing/usage copy, not a code-level audit like the [opencode](./2026-08-14-opencode-comparison.md) or [Letta](./2026-08-12-letta-comparison-independent.md) comparisons. Treat claims about Grok Bot's internals as the author's description, not verified fact.
>
> Grok Bot is not a coding-agent framework and isn't a peer of Artificer in the way opencode/Letta are — it's a consumer product for personal workflow automation (grocery orders, Slack digests, DoorDash group orders) that happens to also drive Cursor Cloud Agents for coding tasks. The comparison here is narrower: which *specific mechanisms* are worth adapting into Artificer, not an overall architecture diff.

---

## tl;dr

Grok Bot's core idea is **computer use**: each bot gets a persistent cloud VM with a browser, filesystem, and app access, so it can do anything a human does at a screen — not just call APIs. Artificer's worker/planner/reviewer only ever touch a git workspace via `run_shell`, `edit_file`, and `gh` (`docs/reference/roles.md`) — there is no browser or screen capability anywhere in the runtime. Two ideas from the article are worth building on:

1. **A browser tool for computer use** — not primarily for Grok Bot's non-coding use cases (grocery carts, DoorDash), but because Artificer's own house rules already assume this capability and can't currently act on it: `CLAUDE.md`'s "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete" is currently something *only a human running Claude Code* can do — Artificer's `worker`/`reviewer` roles have no way to load a page, click through a flow, or take a screenshot. This is buildable today as an ordinary custom tool (`agent/tools/`), no core change required.
2. **A natural-language permission policy checked before risky actions execute** — Grok Bot's safety model is plain-English allow/block rules in settings, checked by a separate reviewer agent per proposed action (allow/block/escalate). Artificer's `reviewer` role reviews finished plans/work, and the runtime's tool-call hook (`onToolCall`, `packages/runtime/src/llm/loop.ts:136`) fires *after* a tool already executed — there's no pre-execution veto point today. A shallow version (self-checking tools) is buildable now; a general pre-execution gate is a real, if small, core change.

Everything else in the article (persistent cloud VM, session hand-off for logins/2FA, multi-bot "Projects," screen-recording-as-verification) is either already covered by an Artificer equivalent, or a poor fit for Artificer's single-identity, no-control-plane philosophy — see "What not to borrow" below.

---

## What Grok Bot actually is, per the article

- **Compute**: each "bot" runs on a persistent, always-on Linux VM in the cloud. It can navigate web pages, open apps, read/write the filesystem, and take screenshots. Multiple bots on the same VM share browser sessions — signing into a site once makes that session usable by any bot.
- **Hand-off**: when a bot hits something only a human can clear (login, 2FA, CAPTCHA, payment), it hands control to the user, who does the step manually and hands the computer back. Simple secrets (API keys, form fields) can instead be filled via a "secure form" the bot sends.
- **Workflow recording**: a user can demonstrate a task once; the bot records the steps as a reusable routine, later triggered on a schedule or an event (new Slack message, GitHub activity).
- **Memory**: three layers — **user** (name, timezone, preferences, shared across bots), **agent** (a per-bot profile file, akin to an `AGENTS.md`, plus an interaction log), **project** (shared memory for decisions/conventions when multiple bots collaborate in a "Project").
- **Composability**: bots can trigger other bots, ask each other for help, and work together in group threads ("Projects") with an orchestrator bot delegating to others.
- **Coding integration**: Grok Bot is tightly coupled to Cursor — it can spin up Cursor Cloud Agents for actual coding work and use the GitHub MCP for `gh`-style operations.
- **Safety**: users write allow/block rules in natural language (Settings → Agent). A separate reviewer agent evaluates each proposed action against those rules and can allow, block, or escalate to the user. The article is candid that this is a trust bet, not a technical isolation guarantee — actions execute in an "isolated environment," but the policy itself is prose, not code.
- **Verification**: every agent run is validated via a screen recording the user can watch back.

---

## Mapping to what Artificer has today

| Grok Bot concept | Artificer today | Gap |
|---|---|---|
| Persistent cloud VM per bot | Ephemeral workspace clone per workstream, executed via `run_shell`/`git`/`gh` (`docs/reference/roles.md`) | Different model by design (stateless workspace vs. persistent desktop) — not a gap worth closing, see below |
| Browser/app/screen access | None — no browser, no screenshot capability, no GUI app access anywhere in the runtime | **Real gap**, see Idea 1 |
| Three-layer memory (user/agent/project) | `identity/memories/*.md` with kinds `note`/`document`/`preference`/`claim`/`entity`, plus per-workstream chronicles (`docs/guides/managing-memories.md`) | Mostly covered — Artificer folds "user" facts into `preference`-kind memories rather than a separate layer; not worth splitting out |
| Recorded workflow → scheduled routine | `agent/schedules/<id>.md`, cron/interval triggers, `communicator`/`workstream` actions, already fires on Slack/GitHub activity (`docs/reference/schedules.md`) | Mostly covered — the only delta is *learning* a routine by demonstration vs. hand-authoring the schedule file; minor, not pursued here |
| Session hand-off for logins/2FA/CAPTCHA | N/A — no browser, so no session/auth hand-off exists | Only relevant if Idea 1 is built; see notes there |
| Natural-language policy + reviewer-agent gate per action | `reviewer` role reviews a finished plan or completed work (`submit_review`), not individual in-flight tool calls; `onToolCall` fires post-execution only | **Real gap**, see Idea 2 |
| Multi-bot "Projects" / cross-bot delegation | Single identity, six fixed roles, `invoke_call`-based nesting within one workstream — no cross-identity-repo collaboration primitive | Architectural mismatch with "one agent = one identity repo, no control plane"; not pursued, see below |
| Screen-recording-as-verification | Git diffs, PR review, `submit_review` severity-tagged notes | Artificer's mechanism is stronger for code correctness; a screenshot (from Idea 1) would be a good *addition* to this, not a replacement |

---

## Idea 1: a browser tool for computer use

### Why this is worth it even for a pure coding agent

The article frames computer use as the whole point of Grok Bot, and most of its examples (DoorDash, groceries, Slack digests) are outside Artificer's scope. But there's a use case Artificer already commits to and currently cannot fulfill: `CLAUDE.md` in this repo says

> For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete.

That instruction currently only binds a human-driven Claude Code session. Artificer's `worker` role can run `npm run dev` via `run_shell`, but has no way to *look at* the result — no page load, no click-through, no screenshot. The `reviewer` role is explicitly read-only over files/shell/git (`docs/reference/roles.md`) and has the same blind spot. For any workstream that touches frontend code, Artificer's quality gate is currently "does it build and pass unit tests," not "does the feature actually work when a user opens the page" — exactly the gap the project's own house rules call out.

### Concrete shape

This doesn't need a core-runtime change. Artificer already has a first-class extension point for exactly this: `agent/tools/*.ts` via `defineTool()` (`docs/guides/writing-custom-tools.md`). A `browser` tool (Playwright-backed) fits the existing contract directly:

```ts
// agent/tools/browser.ts
export default defineTool({
  name: 'browser_screenshot',
  description: 'Navigate to a URL (e.g. a locally running dev server) and capture a screenshot. Returns a description of what loaded and any console errors.',
  input: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      actions: { type: 'array', items: { type: 'string' }, description: 'Optional click/fill steps to perform before capturing' },
    },
    required: ['url'],
  },
  roles: ['worker', 'reviewer'],
  async execute(input) { /* Playwright: navigate, act, screenshot, return findings */ },
});
```

Because it runs inside the same workspace/container `run_shell` already has full access to, it introduces no new trust boundary — a worker that can already run arbitrary shell commands and push commits can already reach the network and filesystem a browser tool would use. The only new capability is *looking at rendered output*, not new *reach*.

Where this plugs into the existing quality loop:

- **`worker`**: after implementing a frontend change and starting the dev server, calls `browser_screenshot` against the relevant route(s) as part of its own verification before `report_status` — directly operationalizing the existing `CLAUDE.md` instruction instead of leaving it as a rule only humans follow.
- **`reviewer`**: could load the same screenshot (as evidence attached to the review, not by re-running Playwright itself if the tool is worker-only) to judge visual correctness, not just code correctness — the missing complement to Grok Bot's screen-recording verification model, done more cheaply (one screenshot vs. a full recording) and pointed at Artificer's actual review gate (`submit_review`) instead of a general video log.

### Secondary use case (lower priority)

The same tool generalizes to Grok Bot's non-coding scenarios (checking a deployed environment, reading a dashboard, filling a form) if Artificer is ever pointed at that kind of work — but that's a scope question for the project, not a reason to build this. The frontend-verification case above justifies it on its own.

### What to leave out

- **Session/auth hand-off** (Grok Bot's login/2FA/CAPTCHA flow) — only matters once a browser tool exists and is used for anything requiring authentication beyond what's already in `.env`/CI secrets. Not needed for the dev-server-verification case, since that's unauthenticated localhost. Worth revisiting only if the browser tool's use cases expand.
- **Persistent, always-on VM** — Artificer's per-workstream ephemeral workspace is the right model for a coding agent; a persistent desktop is solving Grok Bot's "personal agent that's always around" problem, which isn't Artificer's problem.

---

## Idea 2: a natural-language policy checked before risky actions execute

### The actual gap

Artificer already has a review role, but it's the wrong shape for this: `reviewer` evaluates a finished plan or completed work (`submit_review`, severity-tagged, `docs/reference/roles.md`) — after the fact, and only for the plan/work artifacts, not for arbitrary tool calls like `git push`, `gh pr create`, `update_provider_config`, or `delete_schedule`. The runtime's only tool-call hook, `onToolCall` in `packages/runtime/src/llm/loop.ts:136`, fires **after** `def.handler(args)` has already run (confirmed by reading `loop.ts:90-155`) — it's a logging/telemetry point, not a veto point. There is currently no place in the codebase where a proposed action can be checked against a policy and blocked before it happens.

Grok Bot's version of this — plain-English allow/block rules, checked by a separate agent per action, with allow/block/escalate outcomes — is a genuinely different mechanism from anything Artificer has, and it's cheap to approximate without a large architectural change.

### Two implementation depths

**(a) Shallow, buildable now — self-checking tools.** Add `agent/policy.md` as a new identity-repo file (same pattern as `agent/instructions.md`, seeded once, human-editable, git-tracked) holding natural-language allow/block rules — e.g. "never force-push to `main`," "escalate before deleting a schedule," "ask before changing spend caps above $X." A small shared helper (`checkPolicy(actionDescription): 'allow' | 'block' | 'escalate'`) reads that file and, for genuinely ambiguous cases, makes one cheap low-tier LLM call to classify the proposed action against the rules — the same tier as the `reviewer` role today. Risky existing tools (`git` push paths, `gh` PR/merge operations, `update_provider_config`, `delete_schedule`) call this helper at the top of their own `execute()` before acting, and on `block`/`escalate` return a message the role can surface via `reply` instead of proceeding. No change to `loop.ts`, no new role — this is additive to tools that already exist, following the exact pattern the custom-tools guide already documents for adding behavior to a tool's `execute()`.

**(b) Deeper, real core change — a pre-execution interceptor.** Generalize by adding an optional `beforeToolCall` hook in `loop.ts` (mirroring the existing `onToolCall`) that runs before `def.handler(args)`, can short-circuit with a synthetic "blocked by policy" result, and is populated from the same `agent/policy.md`. This covers *every* tool automatically (including custom ones written by users, and including the browser tool from Idea 1) rather than requiring each risky built-in tool to opt in individually. More general, more consistent, but it's an actual change to the shared LLM loop rather than an additive tool-level pattern — worth doing once (a) has proven the policy-file format and check semantics are useful in practice, not as a first step.

### Recommendation

Start with (a): it validates whether natural-language policy is actually useful for Artificer's risk surface (which is narrower than Grok Bot's — no payments, no arbitrary web actions today) before committing to a core-loop change. Promote to (b) only if (a) shows real value and the set of "risky tools that need this" grows past what's comfortable to hand-instrument one by one — and note that (b) becomes materially more valuable once Idea 1 (browser tool) exists, since a browser is exactly the kind of open-ended, hard-to-enumerate action surface Grok Bot built this feature for in the first place.

---

## What not to borrow, and why

1. **Multi-bot "Projects" / cross-bot delegation.** Grok Bot's bots are separate personas sharing a VM and a project memory; Artificer's identity is deliberately a single portable git repo per agent, with no control plane (`README.md`). Cross-identity-repo collaboration would mean either merging identities (defeats the "own GitHub identity" model) or inventing an inter-agent protocol — a large scope change for a benefit (bots delegating to bots) that Artificer's `invoke_call`-based role nesting already covers *within* one identity.
2. **Persistent always-on VM per agent.** Solves "personal agent that's always around," which is Grok Bot's problem, not a coding agent's. Artificer's ephemeral per-workstream workspace is the right fit for its actual workload.
3. **Screen-recording as the verification mechanism.** Fine for Grok Bot's broad, hard-to-typecheck action space (grocery carts, DoorDash). Artificer's git diff / PR / `submit_review` verification is a strictly stronger signal for code correctness; a screenshot from Idea 1 is a good *addition* here, not a replacement.
4. **Policy-as-prose as the *only* safety mechanism.** The article itself flags this as "the biggest mental hurdle" and settles for trust rather than a technical isolation guarantee. Idea 2 above deliberately keeps this as one more check layered on Artificer's existing role-scoped tool access (`docs/guides/writing-custom-tools.md`'s `roles` field) and reviewer gate — not a replacement for either.

---

## Sources

- Article: X article by `mattyp` (`https://x.com/mattyp/article/2087252657589412119`), pasted into conversation 2026-08-17 (not independently fetchable — see note at top).
- Artificer: `docs/reference/roles.md`, `docs/guides/managing-memories.md`, `docs/reference/schedules.md`, `docs/guides/writing-custom-tools.md`, `README.md`, `packages/runtime/src/llm/loop.ts:90-155`, `packages/runtime/src/engine/call.ts:366`.
