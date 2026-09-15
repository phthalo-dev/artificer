# Artificer vs. Conductor — Comparison (2026-09-08)

> Research conducted 2026-09-08. No local checkout exists for Conductor (closed-source); this is built from `conductor.build/docs` and marketing pages, plus independent reviews, Hacker News/Product Hunt discussion, and a Vercel case study, cross-checked against Artificer's own `docs/` and `packages/runtime/src/`. Treat claims sourced only from secondary reviews as flagged inference, not verified fact — the underlying research report calls these out explicitly per-section. See the sibling doc, [Paseo comparison](./2026-09-08-paseo-comparison.md), for the other close peer in this category — both orchestrate *existing* agent CLIs rather than shipping their own inference loop.

---

## tl;dr

**Conductor is a closed-source, VC-backed (YC S24, $22M Series A), macOS-only desktop app** that runs Claude Code, Codex, Cursor, and OpenCode in parallel against git-worktree-isolated workspaces, with a polished Diff Viewer, a "Checks" merge-readiness panel, and — as of mid-2026 — an optional cloud execution backend (Vercel Sandbox microVMs) that adds real-time multiplayer collaboration on top of what started as a single-player local tool.

**Artificer is a self-hosted, cross-platform, deterministic-FSM autonomous colleague** with its own GitHub identity, git-tracked memory, and a worker role that can already delegate to Claude Code or Cursor as an executor (`docs/reference/config.md` §`executor`) — but with no rendered diff review, no merge-readiness dashboard, and no live multi-viewer collaboration on a running workstream.

The overlap is real (both shell out to Claude Code/Codex/Cursor-family CLIs and use isolated git working trees for parallelism) but the products serve different jobs: Conductor is a *reviewable* multi-agent cockpit for one developer with a Mac; Artificer is an unattended colleague that plans, reviews, and merges its own work without a human sitting in a Diff Viewer. Conductor's most exportable lessons for Artificer are entirely in the **review/merge UX** it has clearly invested in — not in its business model, platform choice, or lack of task decomposition.

| Dimension | Conductor | Artificer | Note |
|---|---|---|---|
| License / access | Closed-source, VC-backed SaaS | (repo license TBD per earlier research), self-hosted | Different worlds |
| Platform | macOS only | Any Node.js host (Linux/macOS/Windows, Docker, cloud) | Real Artificer advantage |
| Isolation | Git worktree per workspace, always | `git clone --depth 1` per workstream (`packages/runtime/src/engine/git-ops.ts:32`) | See borrow #2 |
| Sandboxing | None locally (full user permissions); sandboxed only in paid Cloud tier | Deny-by-default tool-approval policy (`docs/reference/config.md` §Tool approval policy) | Artificer ahead here |
| Task decomposition | Manual — human splits work into workspaces | Automated — planner role writes `plan.md` (`docs/reference/roles.md`) | Real Artificer advantage |
| Review UX | Diff Viewer + inline comments + Checks (PR/CI/deploy/todos) merge-readiness panel | Reviewer role writes severity-tagged text notes (`submit_review`); `WorkstreamDetailPage.tsx` shows no diff rendering | Real Conductor advantage — Tier 1 borrow |
| Collaboration | Real-time multiplayer on Cloud workspaces (Pro tier, 5 users) | Single-viewer web UI + SSE | Conductor advantage, low priority for Artificer |
| Persistent identity/memory | None found — each workspace is stateless between runs aside from committed docs | Git-tracked `identity/memories/*.md`, chronicles, distillation | Real Artificer advantage |
| Business model | Free (local) / Pro $50/mo / Teams $60/user/mo / Enterprise custom | Self-hosted, no per-seat SaaS layer | Different bets |

---

## What Conductor actually is

Founded by Charlie Holtz and Jackson de Campos (previously built Melty, an open-source AI code editor), Conductor started in 2024 as a purely local Mac app and, per a Vercel case study, added **Conductor Cloud** in mid-2026 — remote execution on Vercel Sandbox microVMs — specifically because local agents were pinning laptop CPUs/fans and dying whenever the lid closed. It is not a coding agent itself: it wraps the official Claude Code, Codex, Cursor (Composer), and OpenCode CLIs/products as subprocesses, and does not appear to call any model API directly (BYO subscriptions/keys on every tier, no included model usage).

**Isolation is git-worktree-only, no alternative mode.** Each workspace = one worktree = one checkout with its own branch; a branch can only be checked out in one workspace at a time. Untracked files (`.env`, generated files, `node_modules`) aren't carried by worktrees, so bootstrapping them is a documented, manual scripting concern — an independent reviewer (madewithlove) called this out as real friction. **No sandboxing locally**: Conductor's own docs state local agents "run with the same permissions as your user account... no sandboxing"; the *only* sandboxed execution path is the paid Cloud tier's Vercel-Sandbox-backed microVMs.

**The scripts/hooks system** (`.conductor/settings.toml`) is structurally identical in shape to Paseo's workspace hooks, independently arrived at: `scripts.setup` (once, post-creation — install deps, copy `.env`, seed a DB), `scripts.run` (named targets, `concurrent`/`nonconcurrent` run modes), `scripts.archive` (cleanup on archive), with `CONDUCTOR_PORT`/`CONDUCTOR_WORKSPACE_PATH`/`CONDUCTOR_WORKSPACE_NAME` env vars auto-injected (`CONDUCTOR_PORT` is notably *not* set in cloud workspaces).

**The review surface is where Conductor has clearly invested most.** The **Diff Viewer** (⌘⇧D) shows unified or per-commit diffs, takes inline comments that get sent back to the agent, surfaces GitHub PR review threads inline, and (as of v0.84.0) supports direct in-diff file editing. The **Checks tab** aggregates git status, PR metadata, CI status, deployment status, GitHub comments, and outstanding todos into one "is this mergeable" view, and can discourage merging while checks are unresolved. Agent modes (Plan vs. Fast) and a notably deep completion-sound library round out the day-to-day UX polish.

**Multiplayer** (early-access v0.77.0, general on Cloud/Pro) lets a workspace be shared by link, shows presence, and supports live co-prompting — a genuinely new axis added on top of what began as a single-player tool. The **Conductor API** (beta, `https://api.conductor.build/v0`, bearer auth) exposes programmatic workspace creation, prompt sessions, and SQL-style transcript search across an org. **Conductor MCP** works both directions: Conductor is an MCP server itself (external agents can create/manage cloud workspaces, review diffs, inspect files via Conductor's own tools) and an MCP client (it surfaces whatever MCP servers the underlying Claude Code/Codex/Cursor config already declares, without inventing its own config format).

Pricing is a conventional SaaS ladder — Free (local only) / Pro $50/mo (+ Cloud, multiplayer up to 5, API) / Teams $60/user/mo (admin portal, centralized billing) / Enterprise custom (SSO/SCIM, DPA) — with no usage-based cloud-compute billing yet, an aggressive-sounding trade-off the docs themselves flag as temporary ("not right now, but we plan to introduce usage-based pricing").

## Framing: a reviewable cockpit, not an unattended colleague

Conductor's implicit thesis, echoed by an independent comparison (Augment Code's Intent-vs-Conductor piece) and a Medium reviewer's framing, is: *you are the tech lead reviewing PRs from junior engineers who don't sleep* — the human still manually decomposes work into independently-mergeable chunks, and Conductor's job is to make running and reviewing many of those chunks in parallel pleasant. Artificer's thesis is different: the planner role automates decomposition, the reviewer role gates progress with severity-tagged verdicts before the next task starts (`docs/reference/roles.md` §Reviewer), and the whole point is that a human isn't required to sit in a diff viewer for routine work.

That means Conductor's review/merge UX is a genuine, adoptable gap-filler for Artificer — a human *does* still want to spot-check Artificer's work sometimes, and today that means reading `WorkstreamDetailPage.tsx`'s task/review/plan list as text, not a diff. But Conductor's task-decomposition story, sandboxing posture, and platform choice are all things Artificer is already ahead of or intentionally different from, and shouldn't chase.

---

## Borrow ranking for Artificer

### Tier 1 — High value, fits Artificer's product

#### 1. A rendered diff review + merge-readiness view in the UI

**Why:** Artificer's reviewer role already produces exactly the ingredients Conductor's Checks tab aggregates — severity-tagged notes (`submit_review`), plan status, task list, and (via `gh`) PR/CI state — but nothing in `packages/ui/src/pages/WorkstreamDetailPage.tsx` renders an actual diff or aggregates PR/CI/deploy state into one "is this mergeable" view. This is the single highest-leverage idea in this document: Artificer already computes the inputs, it just doesn't render them the way Conductor does.

**Where in Conductor:** Diff Viewer + Checks tab (`conductor.build/docs`, no local source to cite).

**Artificer fit:** A diff-rendering panel on `WorkstreamDetailPage.tsx` sourced from the same `changedFilesSummary`/`includeDiff` data already computed for role context (`packages/runtime/src/engine/call.ts:228`), plus a small "Checks" strip surfacing CI/PR status already available via `gh` calls the worker/reviewer make.

#### 2. Workspace run/service scripts with port allocation

**Why:** Identical finding to the Paseo comparison — Conductor's `.conductor/settings.toml` `scripts.setup/run/archive` with `CONDUCTOR_PORT` is structurally the same primitive as Paseo's `service`-scripts with `PASEO_PORT`. Two independent products converging on the same shape is strong evidence this is a real, common need, not a Paseo-specific quirk — see [Paseo comparison, Tier 1 #2](./2026-09-08-paseo-comparison.md#1-git-worktrees-instead-of-full-clones-for-workstream-workspace-isolation) for the fuller writeup and the concrete `CLAUDE.md` rule it would satisfy. Treat this as one shared backlog item, not two.

#### 3. Direct in-diff file editing (lower priority than #1 itself)

**Why:** Once a diff viewer exists at all (#1), Conductor's v0.84.0 addition of editing directly inside the diff is a natural, cheap follow-on for a human doing a quick manual touch-up on Artificer's work without opening a full editor.

**Artificer fit:** Not worth sequencing ahead of #1 — this only matters once there's a diff view to edit inside of.

#### 4. Notification/completion-sound polish

**Why:** Small, cheap user-delight feature. Artificer already has an SSE event stream (`/events`) and a web UI; Conductor's deep, named completion-sound library is a repeatedly-requested feature in its own changelog/issues — evidence this kind of polish matters more to users than it costs to build.

**Artificer fit:** A configurable completion-sound/desktop-notification hook off the existing workstream-status SSE events — no new backend primitive required.

### Tier 2 — Valuable if Artificer's review surface grows

#### 5. Public transcript/history search API parity check

Conductor's API beta exposes SQL-style transcript search across an org. Artificer's internal `search_history` tool (available to communicator/planner/librarian per `docs/reference/roles.md`) already answers "did we already try fixing this" — but `docs/reference/api.md` doesn't currently expose that query externally over HTTP the way workstream/review/task data already is. Worth a direct parity check, not new design work, since the internal capability already exists.

#### 6. An explicit "skip planner" fast-path preset

Conductor's Plan vs. Fast agent-mode toggle maps loosely to Artificer's planner stage always running. The borrowable idea isn't a new mode concept — Artificer's planner *is* Plan Mode — it's a config/preset question: a preset that skips straight to worker for goals trivial enough not to need a written plan. Low priority; only worth it if bench data shows planner overhead hurting simple-goal latency.

#### 7. Live multi-viewer collaboration on a running workstream

Only relevant if Artificer positions itself for teams co-watching or co-steering one agent's work in real time. Today's SSE + web UI is single-viewer-oriented but not architecturally opposed to multiple viewers — not worth building speculatively.

### Tier 3 — Wrong shape for Artificer, don't chase

| Idea | Why deprioritize |
|---|---|
| macOS-only native app | Directly contradicts Artificer's "runs anywhere Node.js runs" self-hosting thesis; this is Conductor's own biggest adoption limiter (per multiple "alternatives for Windows/Linux" articles written specifically because of this gap) — not something to risk inheriting |
| No local sandboxing as an acceptable trade-off | Conductor ships full-user-permission local execution and calls that fine, with sandboxing reserved for a paid cloud tier; Artificer's deny-by-default tool-approval policy is already ahead here — don't regress toward "just trust the human's account" |
| Subscription SaaS layered over BYOK | A business-model choice, not an engineering pattern — nothing here to borrow mechanically |
| Git-worktree-per-workspace as the *only* isolation mode | Worth adopting as an option (Tier 1 #2, shared with the Paseo finding), but Conductor has no non-worktree "local" mode the way Paseo does; Artificer should keep clone-vs-worktree as a choice, not force one |
| Manual task decomposition | Conductor requires the human to split work into independently-mergeable chunks; Artificer's planner already automates this — a real differentiator, not a gap |

---

## Gaps Conductor highlights in Artificer

1. **No rendered diff review UI** — the reviewer role's output is text-only markdown notes (`submit_review`); nothing in `packages/ui` renders a diff.
2. **No merge-readiness/CI-aggregation view** — the underlying data (PR state via `gh`, review verdicts, task status) already exists per-workstream but isn't surfaced as one dashboard.
3. **No live multi-viewer collaboration** — not necessarily worth closing, but worth naming as a scope decision rather than an oversight.
4. **No externally-exposed transcript/history search** — `search_history` exists internally (`docs/reference/roles.md`) but isn't in `docs/reference/api.md`'s surface; worth a direct parity check against Conductor's transcript-search API.

## What Artificer should *not* change because of Conductor

- **Automated task decomposition** — Conductor's manual-decomposition requirement is a real limitation of that product (called out explicitly by an independent comparison as a reason it doesn't scale to "cross-service, spec-driven coordination"); Artificer's planner role is a genuine advantage here, not something to simplify away.
- **Persistent git-tracked identity/memory** — Conductor workspaces are stateless between runs aside from committed docs (CLAUDE.md/AGENTS.md-style); Artificer's `identity/memories/*.md` + distillation is a structural advantage worth keeping, not trading for Conductor's simplicity.
- **Cross-platform self-hosting** — don't let Conductor's macOS-only polish read as validation for narrowing platform support; it's the opposite lesson (macOS-only is Conductor's most-cited limitation in independent reviews).
- **Tool-approval policy over "trust the user's account"** — Artificer already gates dangerous tool calls by default; Conductor's local no-sandbox posture is a trade-off it made for simplicity, not a model to imitate.
- **Self-hosted, non-SaaS business model** — orthogonal to the technical comparison; noted only as a data point, not a lesson.

## Suggested next steps (if acting on this research)

Priority order — #1 shares a root cause with the Paseo comparison's #1, so sequence them together if both are pursued:

1. **Rendered diff + merge-readiness view in `packages/ui`** — highest leverage; the underlying data already exists in role context and `gh` calls, this is purely a rendering/aggregation gap.
2. **Workspace run/service scripts with port allocation** — identical item to the Paseo comparison's Tier 1 #2; do this once, cite both docs.
3. **Completion-sound/notification polish** — cheap, off existing SSE events.
4. **`search_history` API parity check** — verify whether `docs/reference/api.md` should expose it; likely a small addition, not a design project.

Everything in Tier 2/3 should wait for a concrete signal (bench data on planner overhead, a real multi-viewer request) rather than being pulled forward speculatively.

---

## Key references

```
# Conductor (no local checkout — closed source; web-sourced only)
https://www.conductor.build/docs
https://www.conductor.build (marketing/pricing)
https://api.conductor.build/v0 (API beta)
Independent sources: madewithlove blog review, Augment Code "Intent vs. Conductor" comparison,
  Vercel Conductor Cloud case study, Hacker News discussion threads, Product Hunt reviews

# Artificer
/Users/danielbanks/dev/artificer/packages/runtime/src/engine/git-ops.ts
/Users/danielbanks/dev/artificer/packages/runtime/src/engine/call.ts
/Users/danielbanks/dev/artificer/packages/ui/src/pages/WorkstreamDetailPage.tsx
/Users/danielbanks/dev/artificer/docs/reference/roles.md
/Users/danielbanks/dev/artificer/docs/reference/api.md
/Users/danielbanks/dev/artificer/docs/reference/config.md
/Users/danielbanks/dev/artificer/CLAUDE.md
```
