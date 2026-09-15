# Fresh Eyes: First Impressions as a New Contributor

> Written 2026-07-02, based on a first read-through of the repo with no prior context beyond what's in the working tree and git history.
>
> **Update 2026-07-02:** every finding below has been addressed in a follow-up pass (same day). Each section notes what changed. The one item deliberately left alone is the in-progress CLI-executor overlap, called out at the end.

## tl;dr

The actual product — `packages/runtime` — is a well-designed, actively-developed, well-tested system with genuinely good `docs/`. But it's the *second* thing this repo tried to build, and the first attempt (a TanStack Start + Prisma + EC2 control plane) was never cleaned up. It still occupies the root `README.md`, `SETUP.md`, and `DATABASE_SETUP.md`, and an empty `apps/` directory. A new contributor's first 15 minutes are spent reading three long, confident, detailed setup guides for a product that no longer exists before discovering the real one in `docs/`.

## What the project actually is (once you find the real docs)

Artificer runs an AI coding agent as a standalone process (`packages/runtime`) that has its own portable "identity" — a git repo containing its config, instructions, custom tools, and memories. You message it (web UI, Slack, Discord), it spins up a hierarchy of role-based LLM calls (communicator → orchestrator → planner → reviewer → worker) to do the work, and persists everything as files under an exec directory. `packages/cli` scaffolds and runs agent projects; `packages/ui` is the dashboard.

This is a coherent, well-scoped idea, and `docs/introduction/`, `docs/getting-started/`, and `docs/reference/` explain it clearly and concisely. `docs/research/2026-06-22-eve-comparison.md` is a genuinely sharp competitive-positioning doc that made the "why does this exist" question click faster than anything else in the repo.

## Biggest friction point: three confidently wrong onboarding docs

- **`README.md`** (root) describes a "control plane" managing AI agents on dedicated EC2 instances, with a TanStack Start web app, Prisma/PostgreSQL, tRPC, Auth.js, and an `apps/web` + `apps/orchestrator` layout. None of this exists — `apps/` is an empty directory, there's no Prisma schema anywhere, and the project has no database at all (state is file-based, per `docs/getting-started/core-concepts.md`).
- **`SETUP.md`** and **`DATABASE_SETUP.md`** go even further: step-by-step Neon/Supabase/Railway/Docker Postgres setup, `pnpm db:generate`/`db:push` instructions, a sign-up flow at `/auth/signup`, a "Phase 1 Complete ✅" status footer. All of it is for the abandoned architecture.
- The README's own doc links are broken: it points to `docs/self-hosting.md`, `docs/architecture.md`, `docs/api.md` — none of which exist. The real equivalents live at `docs/guides/deploying-to-production.md`, `docs/introduction/how-it-works.md`, and `docs/reference/api.md`.

`git log --oneline -- README.md` shows exactly one commit touching it: the squashed initial `First` commit back in February. Everything since then — the entire real product — was built without anyone circling back to update root-level docs. This is the single highest-value fix available: delete or fully rewrite these three files. Right now they actively cost every new reader time and trust ("wait, do I need Postgres or not?").

**Fixed:** `README.md` rewritten to describe the actual runtime/CLI/UI architecture, with working links into `docs/`. `SETUP.md` and `DATABASE_SETUP.md` deleted outright — everything in them is superseded by `docs/getting-started/quickstart.md`, and there is no database in the current architecture to set up.

## Repo hygiene noise

- An empty `apps/` directory is still checked out — a fossil of the old layout, doesn't even hold a `.gitkeep`.
- Two stray, unmistakably test-generated directories sit at repo root: `tool-results-test-6DJBxw/` and `file-cache-test-vtex1U/`, both `drwx------` and dated the same minute. These look like a test suite writing scratch output to `process.cwd()` instead of a temp dir — worth tracing (likely in `packages/runtime/src/tools/tool-result-read.ts` or the context-borrowing/file-cache tests) and fixing so `pnpm test` doesn't litter the working tree.
- `cost.json` (245KB, a captured cost report with a real-looking code-review message embedded in it) sits at root. It's gitignored so it's not a tracked-file problem, just a "why is this here" moment for a new clone that happens to inherit someone's working directory.
- Deployment story is split three ways with no cross-linking: `infrastructure/` (AWS CDK, EC2 personal runtime), `docker/bridge.Dockerfile` + root `Dockerfile` + `fly.toml` (Fly.io, per `docs/deploy-fly.md`), and presumably whatever `docs/guides/deploying-to-production.md` covers. Each is internally coherent, but nothing tells a newcomer which one is "the" recommended path versus an alternative.

**Fixed:**
- `apps/` removed (it was genuinely empty).
- Root-caused the stray dirs: `packages/runtime/src/storage/tool-results.test.ts` and `packages/runtime/src/engine/file-cache.test.ts` were the only two test files in the whole suite using `path.join(process.cwd(), ...)` for their temp dir instead of `os.tmpdir()` (every other test file already used the latter). Fixed both to use `os.tmpdir()`, verified they still pass, and deleted the two leftover directories. `docs/deploy-fly.md` turned out to be intentional, not stray — it was left in place after its content was folded into `docs/guides/deploying-to-production.md`.
- `cost.json` is a local, gitignored debug artifact (not tracked) — left as-is; nothing to fix in the repo itself.
- Added a one-line cross-link each way between `infrastructure/README.md` (AWS/EC2 path) and `docs/guides/deploying-to-production.md` (Fly.io/Docker path), plus a "Deployment" pointer in the new root README, so a reader lands on either doc and immediately knows the other exists.

## What's genuinely good

- **`docs/` is well-organized and written for a reader, not a changelog.** Introduction → getting-started → guides → reference is a sensible progression, and the writing avoids marketing fluff (a real contrast with the root README's emoji bullet list).
- **The runtime code is well-tested.** 59 `*.test.ts` files alongside implementation files in `packages/runtime/src/`, colocated rather than in a separate mirror tree — easy to find the test for anything.
- **Config is centralized and its precedence is explicit** (`packages/runtime/src/config.ts`): env vars → config-file definition → preset defaults, with a clear `modelPresetId` audit trail ("custom" vs a named preset) so you can tell after the fact whether defaults were overridden.
- **The project appears to be substantially built via a spec-driven-development process on itself** — at the time of this review, `docs/superpowers/specs/` and `docs/superpowers/plans/` contained ~20 dated design docs (memory/teaching, quota tracking, executor design, role customization, etc.), and `.superpowers/sdd/` held per-task briefs, reports, and reviewer diffs for a documentation pass. Those Superpowers files later moved to local-only `.docs/` and are no longer committed. For a project whose product *is* an AI agent that plans and reviews its own work, building the project the same way is a nice bit of dogfooding, and the design-doc trail is a genuinely useful "why" record that the code alone wouldn't give me.
- **CI is scoped sensibly**: `.github/workflows/ci.yml` only runs `pnpm ci:packages` (type-check, test, build for runtime/ui/cli) — it doesn't pretend to build the dead `apps/` layout.

## Smaller points of confusion

- Root `package.json` scripts (`db:generate`, `db:push`, `db:migrate`) still reference database tooling that no longer exists anywhere in the workspace — running any of them would presumably no-op or fail since no package defines those turbo tasks anymore. Worth confirming and pruning.

  **Fixed:** removed `db:generate`/`db:push`/`db:migrate`/`db:studio` from root `package.json` (the last one literally did `cd apps/web`, which no longer exists) and removed the matching dead pipeline entries from `turbo.json`.

- The runtime's own `package.json` has ~25 `bench:*` scripts (per-preset SWE-bench/DeepSWE variants: `go-economy`, `go-flash`, `go-mimo`, `go-quality`, `go-minimax`, `quality-first`, `ultra-budget`, `async-slow`, `bench-budget`...). Useful once you know what a "preset" is, but there's no README pointer from the script names to `packages/runtime/bench/README.md` — I had to guess it existed.

  **Fixed:** added a short "Benchmarking" section to `packages/runtime/README.md` pointing at `bench/README.md`.

- Two env var namespaces for the same knobs coexist by design (`LLM_MODEL*` and legacy `ANTHROPIC_MODEL*`, `LLM_API_KEY`/`ZEN_API_KEY`/`ANTHROPIC_API_KEY`) — this is explained once in `config.ts` comments but not in `docs/reference/env-vars.md` at a glance; a newcomer picking env vars from the code vs. the docs could reasonably pick either name and not know one is legacy.

  **Fixed:** added a one-line note at the top of `docs/reference/env-vars.md` explaining that "Alias" entries are legacy fallbacks and which name to prefer.

- There's active in-progress work on a "CLI executor" (`packages/runtime/src/engine/cli-executor.ts`, uncommitted changes across `engine.ts`/`roles.ts`/`registry.ts`) alongside a very similar existing concept (`docs/guides/custom-cli-executor.md`, `docs/guides/qwen-code-executor.md`). Not a problem, just flagging that a new contributor arriving mid-branch would want to check with whoever's driving that work before touching the same files.

  **Left alone, deliberately:** this is someone else's in-flight, uncommitted work, not a hygiene defect — touching those same files here would risk stepping on it. It's a heads-up for whoever picks it up next, not a fix for this pass.

## If I could fix one thing today

Delete (or radically rewrite) `README.md`, `SETUP.md`, and `DATABASE_SETUP.md` to describe the actual current architecture, or at minimum add a one-line banner at the top of each pointing to `docs/introduction/what-is-artificer.md` and `docs/getting-started/quickstart.md`. Everything else here is polish; this is the thing actively misleading people on day one.

**Done.** All items above are fixed as of the same-day follow-up pass, except the CLI-executor overlap, which is left for whoever owns that in-progress work.
