# Artificer

Artificer runs AI coding agents that have their own GitHub identity — their own account, commits, and PRs, not yours. The agent is a git repo (its "identity repo": config, instructions, custom tools, channels, and the memories it writes over time), so you can clone it anywhere and run the same agent in a new place. No state is locked inside a service.

You talk to the agent through a web UI, Slack, or Discord. Send it a message describing what you need — fix a bug, review a PR, clean up a module — and it plans the work, executes it in the background, and reports back.

Self-hostable and open-source. Runs anywhere Node.js runs.

## How it works

Every role the agent plays — communicator, orchestrator, planner, reviewer, worker — is one LLM tool-use call. The shared `orchestrator` tool lets any call inspect system state and spawn child calls, which is what lets a single inbound message turn into a whole tree of planned, reviewed work:

```
inbound message
      │
      ▼
 communicator ── reply ──▶ you
      │  (start / steer / status)
      ▼
 orchestrator ◀────────────────┐  (re-invoked after every child finishes)
   │ invoke_call               │
   ├──▶ planner  ── plan.md ───┤
   ├──▶ worker   ── 1 file ────┤
   └──▶ reviewer ── notes ─────┘
```

See [How it works](docs/content/docs/introduction/how-it-works.md) for the full mental model, and [Core concepts](docs/content/docs/getting-started/core-concepts.md) for the vocabulary (workstreams, channels, executors, memories).

## Project structure

This is a pnpm/Turborepo monorepo:

```
artificer/
├── packages/
│   ├── runtime/   # @artificer-ai/runtime — the agent itself: HTTP server, role
│   │               # engine, tools, storage, benchmarking suite (bench/)
│   ├── cli/       # @artificer-ai/cli — `artificer init|dev|start`
│   └── ui/        # @artificer-ai/ui — the web dashboard, built into runtime/ui-dist
├── infrastructure/ # AWS CDK stack for a personal, hibernating EC2 deployment
├── docker/         # Sidecar images used by the infrastructure deployment
└── docs/           # Astro docs site; published pages in docs/content/docs/
```

There is no separate control-plane app and no database — a running agent is a single Node.js process that persists everything as files under `ARTIFICER_EXEC_DIR` (default `~/.artificer/<name>/`).

## Quick start

```bash
npm install -g @artificer-ai/cli
artificer init my-agent
cd my-agent
npm install
# add your LLM key to .env (LLM_API_KEY — an OpenCode Zen key or a provider key)
artificer dev
```

Open `http://localhost:4100` and send it a message. Full walkthrough: [Quickstart](docs/content/docs/getting-started/quickstart.md).

### Working on Artificer itself

To develop the runtime/CLI/UI packages in this repo (rather than a scaffolded agent project):

```bash
pnpm install
pnpm dev          # turbo run dev across packages
pnpm build        # build all packages
pnpm lint         # lint all packages
pnpm type-check   # type-check all packages
pnpm ci:packages  # what CI runs: type-check, test, and build the publishable packages
pnpm --filter docs dev   # docs site at http://localhost:4321
```

## Documentation

- [What is Artificer?](docs/content/docs/introduction/what-is-artificer.md) / [How it works](docs/content/docs/introduction/how-it-works.md)
- [Quickstart](docs/content/docs/getting-started/quickstart.md) / [Core concepts](docs/content/docs/getting-started/core-concepts.md)
- Guides: [agent identity setup](docs/content/docs/guides/agent-identity-setup.md), [writing good goals](docs/content/docs/guides/writing-good-goals.md), [Slack & Discord](docs/content/docs/guides/slack-discord-connections.md), [custom tools](docs/content/docs/guides/writing-custom-tools.md), [custom channels](docs/content/docs/guides/writing-custom-channels.md), [managing memories](docs/content/docs/guides/managing-memories.md), [custom CLI executors](docs/content/docs/guides/custom-cli-executor.md), [deploying to production](docs/content/docs/guides/deploying-to-production.md)
- Reference: [CLI](docs/content/docs/reference/cli.md), [config](docs/content/docs/reference/config.md), [env vars](docs/content/docs/reference/env-vars.md), [HTTP API](docs/content/docs/reference/api.md), [roles](docs/content/docs/reference/roles.md)

## Deployment

For a scaffolded agent project, [Deploying to production](docs/content/docs/guides/deploying-to-production.md) covers Fly.io and plain Docker — the fastest paths to a self-hosted instance ($3–8/month).

`infrastructure/` in this repo is a separate path: an AWS CDK stack the maintainers use for a personal, hibernating EC2 deployment (wakes on message via SQS, ~$3–8/month idle). See [infrastructure/README.md](infrastructure/README.md) if you specifically want the AWS route instead of Fly.io/Docker.

## Contributing

Issues and PRs are welcome. `docs/` is the docs site (published pages under `docs/content/docs/`); the code under `packages/runtime/src/` is the best starting point for understanding the implementation (colocated `*.test.ts` files next to the code they test).

## License

MIT License — see [LICENSE](LICENSE) for details.
