---
title: What Is Artificer?
description: Artificer runs AI coding agents that have their own GitHub identity.
---

# What Is Artificer?

Artificer runs AI coding agents that have their own GitHub identity. The agent gets its own GitHub account, makes commits under its own name, and opens PRs from its own profile — not yours.

## The agent is a git repo

Everything that defines the agent lives in a directory called the identity repo: its configuration, standing instructions, custom tools, channel definitions (Slack, Discord), and the notes it writes to itself over time. Clone the identity repo anywhere, run `artificer start`, and you have the same agent running in a new location. No state is locked inside a service.

## How you interact with it

You talk to the agent through a web UI, Slack, or Discord. Send it a message describing what you need — fix a bug, review a PR, clean up a module — and it figures out a plan, does the work in the background, and reports back when it's done or if it needs something from you.

## Self-hostable

Artificer is open-source and runs anywhere Node.js runs. You operate it on your own infrastructure. The agent appears in your GitHub history as a distinct person with its own avatar and account — distinguishable from you and from the rest of your team.

## Next steps

- [Quickstart](/docs/getting-started/quickstart) — get an agent running in under 10 minutes
- [How it works](/docs/introduction/how-it-works) — the mental model behind the orchestration
