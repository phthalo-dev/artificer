# Artificer vs. Paseo — Comparison (2026-09-08)

> Research conducted 2026-09-08 via a parallel deep-dive into the local checkout at `/Users/danielbanks/dev/paseo` (README, `docs/`, `public-docs/`, `skills/`, `plugin-examples/`, package manifests, `CHANGELOG.md`) plus live fetches of `paseo.sh` and `github.com/getpaseo/paseo`, cross-checked against Artificer's own `docs/` and `packages/runtime/src/`. Version examined: 0.8.0-beta.1 (2026-09-08). See the sibling doc, [Conductor comparison](./2026-09-08-conductor-comparison.md), for the other close peer in this category — both Paseo and Conductor orchestrate *existing* agent CLIs rather than shipping their own inference loop, which is the key structural difference from every prior comparison in this directory (Codex, opencode, Letta), where the competitor *was* an agent.

---

## tl;dr

**Paseo is a self-hosted orchestration daemon for coding-agent CLIs you already have installed** (Claude Code, Codex, Copilot, OpenCode, Pi, plus a 30+-agent ACP catalog). It never runs inference itself and never touches your API keys — it spawns, supervises, and streams agent-CLI subprocesses behind one WebSocket protocol, with native desktop/mobile/web/CLI clients, an E2EE relay for phone pairing, and a genuinely rich trusted-but-unsandboxed TypeScript plugin system.

**Artificer is an autonomous colleague with its own GitHub identity** — a deterministic plan→work→review workstream FSM, a portable git-tracked identity repo, and a worker role that can *also* delegate to an external CLI (`executor: "claude-code" | "cursor-agent" | "cli"`, `docs/reference/config.md` §`executor` block) — but only for the worker role, only inside its own structured pipeline, one external process at a time per workstream.

The overlap is real but narrow: both projects treat "shell out to a coding-agent CLI" as a load-bearing primitive. Everything above that point diverges. Paseo is a control surface for *many* agents you already run yourself; Artificer *is* one agent with continuity, review discipline, and a bot identity of its own. Paseo's strongest lessons for Artificer are in **workspace ergonomics** (worktrees, run scripts, service ports) and **shipping a self-usage skill** — not in its orchestration philosophy, which Artificer shouldn't flatten toward.

| Dimension | Paseo | Artificer | Note |
|---|---|---|---|
| What it runs | Existing agent CLIs as subprocesses | Its own role engine; worker *optionally* delegates to a CLI | Different center of gravity |
| Identity | None — agents run as the human operator's own credentials | Own GitHub account, own commits/PRs (`docs/guides/agent-identity-setup.md`) | Artificer's strongest differentiator |
| Orchestration model | Generic: any agent can spawn/message any other agent | Deterministic FSM: planner → worker → reviewer per workstream | Different philosophies, both valid |
| Workspace isolation | `local` or `worktree` mode, hooks, named run/service scripts w/ ports | `git clone --depth 1` per workstream (`packages/runtime/src/engine/git-ops.ts:32`) | Paseo richer — see Tier 1 |
| Memory | None found at the daemon level | Git-tracked `identity/memories/*.md`, kinds, search, distillation | Artificer richer |
| Clients | Desktop, iOS/Android, web, CLI, E2EE relay | Web UI + Slack/Discord/webhook channels | Different scope, not a gap to chase |
| Extensibility | Trusted, unsandboxed TS plugins: UI surfaces, providers, lifecycle hooks | `defineTool`/`defineChannel` files in the identity repo | Paseo's is a real ecosystem; Artificer's is simpler by design |
| Self-usage teaching | Ships 6 Claude Agent Skills (`skills/paseo*`) that teach an agent to drive Paseo well | None | Cheap, high-leverage borrow |
| License / model | Apache-2.0, BYOK, monetizes only an optional paid Hub tier (€15/seat/mo) | (repo license TBD per earlier research) | — |

---

## What Paseo actually is

Paseo's daemon (`packages/server`) is the single source of truth; every client — desktop (Electron), mobile (Expo/React Native, explicitly "not a webview"), web, and CLI — is a thin observer/controller over one WebSocket protocol that mixes JSON session messages with a binary terminal frame protocol. It talks to agent CLIs through two mechanisms: native SDK/wire integration for the "first-class" four (Claude via the Anthropic Agent SDK, Codex via its own AppServer JSON-RPC, OpenCode via its own server, Pi via local RPC), and the open **Agent Client Protocol (ACP)** for everything else (Copilot plus a 30+-agent catalog: Cursor, Gemini CLI, Cline, Goose, and more). Every provider is still an ordinary OS subprocess — Paseo "doesn't proxy model calls" and never stores API keys.

**Workspaces** are the isolation unit: a project (repo or bare directory) holds one or more workspaces, each with isolation mode `local` (shared checkout) or `worktree` (a real git worktree Paseo creates and tears down, referenced-counted across workspaces). Worktree workspaces get `paseo.json`-declared `setup`/`teardown` hooks and named `scripts` — including a `service` type with auto-assigned ports, reverse-proxy URLs (`web--branch--project.localhost:6767`), and `PASEO_PORT`/`PASEO_URL`/`PASEO_SERVICE_*` env vars for cross-service discovery.

**Orchestration** is deliberately generic — not a Paseo-owned role hierarchy, but MCP tools (`create_agent`, `send_agent_prompt`, `list_agents`, `kill_agent`, etc., gated per-provider via `paseoTools.disabledTools`) or plain CLI calls that let *any* agent running inside Paseo spin up or message any other agent by ID, in any workspace. **Agent profiles** (named provider+model+mode bundles with free-text `notes`) are the one piece of "how should I delegate" guidance Paseo ships, and its bundled `paseo` skill enforces calling `list_profiles` before every delegation rather than guessing. **Schedules** (cron → fresh agent) and **heartbeats** (cron → same ongoing agent) are separate primitives. **Hub** is a separate, optional service (self-hosted free or a hosted €15/seat/mo tier) that receives GitHub/Slack/Discord webhooks and runs ordered workflow steps, each starting one agent — this is Paseo's analog to Artificer's channels, deliberately decoupled from the daemon.

**Plugins** are trusted, unsandboxed TypeScript, split into a server half (real Node subprocess, full daemon-host access) and a client half (runs inside every Paseo app, RN-only, no DOM), compiler-enforced at the import level. A plugin can contribute full sidebar screens, workspace panels, Command Center items, slash commands, composer pills/attachment sources, app themes, timeline transformers (including mid-stream), a *complete new agent provider*, eleven lifecycle events, and pre-creation `before()` request rewrites (`plugin-examples/lifecycle-actions` shows one auto-forcing worktree isolation, auto-denying `rm -rf`, and redirecting one provider to another). Trust is binary and per-install — no sandboxing, no capability scoping — and the bundled `paseo-plugin` skill is scripted to refuse enabling plugins without restating that warning.

**Skills bundled with Paseo itself** are the most exportable idea here: six Claude Agent Skills (`paseo`, `paseo-advisor`, `paseo-committee`, `paseo-handoff`, `paseo-help`, `paseo-plugin`), installed via `npx skills add getpaseo/paseo`, that encode *behavioral* discipline for driving Paseo well — "favor asynchronous workflows... don't poll `list_agents`, the notification will tell you," a strict profile-selection protocol, a mandatory zero-context briefing template for handoffs, and a mandatory trust-disclosure gate before flipping on plugins. This is product onboarding shipped as a skill, not a system prompt or a doc page.

**Relay** (opt-in, off by default) uses Curve25519/ECDH + NaCl `box` for E2EE phone pairing; a QR code transfers the daemon's public key and *is* the trust anchor; the relay itself is designed to be untrustworthy — it sees only IPs/timing/sizes and can't forge or read messages even fully compromised.

## Framing: different products, narrow real overlap

Paseo's job is "let me run and coordinate the agent CLIs I already use, from any device, without giving up my own keys or a service provider's lock-in." Artificer's job is "be one autonomous colleague with a GitHub identity who plans, does, and reviews its own work reliably, unattended." The only place these missions actually touch is the executor swap: Artificer's worker role can already shell out to Claude Code or Cursor exactly the way Paseo shells out to those same CLIs (`docs/reference/config.md` §`executor` block; `packages/runtime/src/engine/claude-code-executor.ts`, `cli-executor.ts`). Paseo generalizes that one mechanism into a whole product; Artificer keeps it scoped to one role inside a deterministic pipeline. Neither choice is wrong — they're optimizing for different things (a control surface for many agents vs. one reliable agent-of-record).

So: **do borrow** workspace/dev-loop ergonomics and the self-usage-skill idea. **Borrow carefully** the generic agent-to-agent messaging pattern — only if Artificer ever needs cross-workstream coordination beyond one workstream's own role tree. **Don't borrow** the "no bot identity, agents run as you" model, the fully generic (role-less) delegation philosophy, or the four-native-client investment — all three cut directly against what makes Artificer itself.

---

## Borrow ranking for Artificer

### Tier 1 — High value, fits Artificer's product

#### 1. Git worktrees instead of full clones for workstream workspace isolation

**Why:** Every workstream currently does `git clone --depth 1` into a fresh directory (`packages/runtime/src/engine/git-ops.ts:32,40`, `cloneRepoIntoWorkspace`). That's a full network fetch and full object-store duplication per workstream even when N concurrent workstreams target the same repo. Paseo's worktree isolation mode gets the same working-tree isolation from one shared clone's object store — cheaper and faster, especially under `RUNTIME_CONCURRENCY > 1`.

**Where in Paseo:** `public-docs/worktrees.md`, `public-docs/workspaces.md`.

**Artificer fit:** Add a worktree-backed clone path in `git-ops.ts` alongside the existing full-clone path (keep full clone as a fallback for the first workstream against a repo, or when the repo isn't already cached locally); gate behind config the same way Paseo treats `isolation: "local" | "worktree"` as a per-workspace choice, not a global switch.

#### 2. Workspace "run scripts" with allocated ports for dev-server access

**Why:** `CLAUDE.md`'s own house rule — "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete" — has no runtime primitive behind it today. The worker/reviewer roles only have `run_shell`, `edit_file`, and `gh` (`docs/reference/roles.md`); there's no declared, discoverable way to start "the" dev server for a repo and get a stable port/URL back. Both Paseo (`setup`/`run`/`teardown` hooks, `service`-type scripts, `PASEO_PORT`/`PASEO_SERVICE_*` env vars) and, independently, Conductor (`.conductor/settings.toml` `scripts.setup/run/archive`, `CONDUCTOR_PORT`) converge on the same primitive — that's two independent products validating the same gap.

**Where in Paseo:** `public-docs/worktrees.md` (scripts/services section).

**Artificer fit:** A `workspace.scripts` block in `artificer.config.json` (setup/run/teardown, port auto-allocation) that the worker/reviewer roles can call via a new tool (`start_service`/`stop_service`), with the allocated port surfaced back into context the same way git status is today. This is the one item on this list worth doing regardless of which other items land, since it closes a documented-but-unimplemented product promise.

#### 3. Custom-provider "extend at a different base URL" recipe pattern

**Why:** Artificer's `executor` block already supports `cli`/`claude-code`/`cursor-agent` types (`docs/reference/config.md` §`executor`), but there's no documented recipe for pointing an existing executor type at an Anthropic-compatible third-party endpoint (Z.AI/GLM, Alibaba/Qwen coding plans, etc.) the way Paseo's `custom-providers.md` does for its own provider abstraction.

**Artificer fit:** Documentation + a thin config extension, not new engineering — add worked examples to `docs/reference/config.md` showing `executor.type: "cli"` pointed at OpenAI/Anthropic-compatible third-party base URLs, mirroring Paseo's documented recipes.

#### 4. Ship an Artificer self-usage skill

**Why:** Paseo's most exportable idea is cheap to copy: a Claude Agent Skill, distributed from Artificer's own repo, that teaches *any* Claude Code session (a human's daily driver, or Artificer's own `claude-code` executor) how to write goals Artificer's planner can act on well, which preset/tier to reach for, and what "done" looks like for a workstream. `docs/guides/writing-good-goals.md` already has all the content — it just isn't packaged as an installable skill.

**Artificer fit:** A `skills/artificer/SKILL.md` at repo root, installable via `npx skills add <org>/artificer`, that distills `writing-good-goals.md` + core-concepts into the same kind of behavioral checklist Paseo's `paseo` skill uses.

### Tier 2 — Valuable if Artificer's orchestration surface grows

#### 5. Agent-to-agent messaging by ID + named profiles with delegation notes

Only relevant if Artificer ever needs cross-workstream coordination beyond one workstream's own planner→worker→reviewer tree. Paseo's `send_agent_prompt`-by-ID plus `list_profiles`-before-delegating pattern is a clean reference if that need arises — not worth building speculatively.

#### 6. Policy-management HTTP API shape

Paseo exposes `POST /api/policy/rules` / `DELETE /api/policy/rules/:id`, bearer-authenticated, for managing its approval policy outside of config files. Artificer's tool-approval policy is already file-based and API-manageable in spirit (`docs/reference/config.md` §Tool approval policy references a policy API) — worth a direct parity check against Paseo's shape rather than new design work.

#### 7. Relay-style E2EE remote pairing

Only relevant the day Artificer ships a mobile or remote client. Paseo's Curve25519+NaCl design with "the relay is untrusted by construction" is a solid reference architecture to copy wholesale at that point — not before.

### Tier 3 — Interesting, wrong shape for Artificer today

| Idea | Why deprioritize |
|---|---|
| Native desktop/mobile clients (4 platforms) | Artificer's web-UI + chat-channel model matches its "runs anywhere Node.js runs, no forced client" philosophy; four native clients is a product bet orthogonal to being a good autonomous colleague |
| Full plugin ecosystem (UI surfaces, themes, timeline transformers) | Only justified by a UI-extension marketplace ambition Artificer doesn't have; `defineTool`/`defineChannel`-in-identity-repo is simpler and matches "the identity repo is the whole extension surface" |
| Hub as a separate paid webhook-orchestration product | Artificer's channels (Slack/Discord/webhook) + workstreams already cover this ground in-process; forking into a second paid surface adds a business-model question Artificer hasn't asked |
| Fully generic, role-less delegation | Artificer's deterministic FSM is the differentiator — see below |

---

## Gaps Paseo highlights in Artificer

1. **No git-worktree-based workspace isolation** — every workstream does a full shallow clone (`git-ops.ts:32`), which is heavier than necessary under concurrency.
2. **No workspace "service" primitive** — the CLAUDE.md rule to test UI changes in a browser has no runtime tool behind it.
3. **No agent-to-agent cross-workstream messaging** — not necessarily a gap to close, but worth naming: today, coordination only happens inside one workstream's role tree.
4. **No shipped "how to use me well" skill** — cheap to fix (Tier 1 #4).

## What Artificer should *not* change because of Paseo

- **Deterministic plan→work→review FSM** — Paseo has no equivalent; don't flatten it into "spin up any agent with a prompt just because Paseo's model is more general.
- **Own GitHub identity per agent** — the opposite of Paseo's "agents run as you" model, and Artificer's single strongest differentiator vs. this entire category. Don't dilute it chasing Paseo's multi-tenant-per-daemon flexibility.
- **Simple identity-repo extensibility** over a plugin marketplace — Paseo's plugin system is genuinely richer, but building one prematurely trades Artificer's "clone the identity repo, get the whole agent" simplicity for an ecosystem Artificer doesn't need yet.
- **Single-agent-per-runtime-process model** — Paseo's daemon manages many concurrent unrelated agents by design; Artificer's one-identity-per-process model is intentional (portability, git-tracked memory scoped to one persona), not a limitation to lift.

## Suggested next steps (if acting on this research)

Priority order, informed by the fact that #1 is independently corroborated by the Conductor research (see sibling doc):

1. **Workspace run/service scripts with port allocation** — closes a real, already-documented product promise (CLAUDE.md's browser-testing rule). Highest leverage, no dependency on other items.
2. **Git-worktree-backed workspace isolation** as an option alongside the existing full-clone path.
3. **Ship a self-usage skill** (`skills/artificer/SKILL.md`) — cheap, no runtime change required.
4. Executor custom-base-URL documentation (Tier 1 #3) — pure docs, no engineering.

Everything in Tier 2/3 should wait for a concrete need (multi-viewer collaboration, a mobile client, a plugin marketplace) rather than being pulled forward speculatively.

---

## Key references

```
# Paseo (local checkout: /Users/danielbanks/dev/paseo)
README.md
docs/architecture.md
docs/data-model.md
docs/plugins.md
public-docs/why.md
public-docs/orchestration.md
public-docs/orchestration-workflows.md
public-docs/providers.md
public-docs/supported-providers.md
public-docs/custom-providers.md
public-docs/worktrees.md
public-docs/workspaces.md
public-docs/security.md
public-docs/connectivity.md
public-docs/hub/{index,concepts,hosted}.md
skills/{paseo,paseo-advisor,paseo-committee,paseo-handoff,paseo-help,paseo-plugin}/SKILL.md
plugin-examples/{lifecycle-actions,provider-acp-transformer,provider-direct}/
CHANGELOG.md (0.8.0-beta.1 entry)

# Artificer
/Users/danielbanks/dev/artificer/packages/runtime/src/engine/git-ops.ts
/Users/danielbanks/dev/artificer/packages/runtime/src/engine/claude-code-executor.ts
/Users/danielbanks/dev/artificer/packages/runtime/src/engine/cli-executor.ts
/Users/danielbanks/dev/artificer/docs/reference/config.md
/Users/danielbanks/dev/artificer/docs/reference/roles.md
/Users/danielbanks/dev/artificer/docs/guides/writing-good-goals.md
/Users/danielbanks/dev/artificer/CLAUDE.md
```
