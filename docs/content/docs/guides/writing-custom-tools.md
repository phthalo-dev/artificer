---
title: Writing Custom Tools
description: Custom tools let you give the agent capabilities beyond its defaults — querying internal APIs, reading from a database, searching issue trackers, or anything else your team uses.
---

# Writing Custom Tools

Custom tools let you give the agent capabilities beyond its defaults — querying internal APIs, reading from a database, searching issue trackers, or anything else your team uses. You add them as TypeScript files under `agent/tools/` in your identity repo.

## Where tool files go

```
my-agent/
└── agent/
    └── tools/
        ├── search-jira.ts    ← one file per tool
        └── query-metrics.ts
```

The runtime auto-discovers all `.ts` files in `agent/tools/` at startup. No registration step.

## How tools reach the agent

At startup, the runtime scans `agent/tools/*.ts`, imports each file's default `defineTool()` export, and registers it in the tool registry. Invalid files are skipped with a warning; the process keeps running.

When a role call runs (planner, worker, etc.), the runtime builds a **tool plan** once at call start: the full catalog of built-in and custom tools available to that role. That plan is **frozen for the life of the call** — the model, `execute` program siblings, and codemode cells all use the same snapshot. Adding or editing a tool file takes effect on the next process start; an in-flight call does not pick up changes mid-run.

If you ship many custom tools (more than ~40), the runtime logs a soft warning suggesting deferred discovery (coming soon) to keep the always-on catalog lean.

## The `defineTool()` API

```ts
import { defineTool } from '@artificer-ai/runtime';

export default defineTool({
  name: 'tool_name',           // snake_case, used in LLM tool calls
  description: 'What it does', // shown to the LLM — be specific
  input: {                     // JSON Schema for the input
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
  roles: ['worker', 'planner'], // which roles can call this tool
  needsApproval: true,          // require a matching allow rule
  async execute(input) {        // input is typed from your schema
    // ... do work ...
    return 'result as a string'; // must return a string
  },
});
```

Each field:

- **`name`** — identifier used in LLM tool calls. Use `snake_case`.
- **`description`** — shown to the LLM to decide when to call the tool. Be specific about what it returns, not just what it does.
- **`input`** — a JSON Schema object describing the tool's input. The `execute` function receives a value typed from this schema.
- **`roles`** — which agent roles can call this tool (see below).
- **`needsApproval`** — optional boolean or `(input) => boolean`. When `true`, the tool runs only if an `allow` rule matches the call. A function can gate only selected inputs.
- **`execute`** — the function that runs when the tool is called. Must return a string (or a `Promise<string>`).

## Approval-gated tools

Approval is deny-by-default. When `needsApproval` is `true` (or its function returns `true`), the runtime checks the tool policy before calling `execute`. With no matching rule, the handler does not run and the tool returns a structured JSON error with `kind: "approval_required"`; an explicit deny returns `kind: "approval_denied"`.

Approval is policy-based, not an interactive pause: the runtime does not wait for a person in the middle of a tool call. Add an allow rule, then retry the call. The runtime exposes no model-facing API or tool for changing policy; policy mutations use the bearer-authenticated policy API. See [Tool approval policy](/docs/reference/config#tool-approval-policy) for policy locations and management.

## The `roles` field

Each tool declares which roles are allowed to call it. The available roles are:

- `worker` — does the implementation work; most tools belong here
- `planner` — produces the plan; add tools here if the planner needs to look things up to plan well (e.g. listing available services, checking ticket status)
- `reviewer` — reviews work; rarely needs custom tools
- `orchestrator` — manages workstream state; almost never needs custom tools
- `communicator` — talks to the user; almost never needs custom tools

Tip: most tools should be `['worker']` or `['worker', 'planner']`.

Worker and orchestrator can also call custom tools from the `execute` program as `await tools.<name>(input)`. `execute` is a reserved name — a custom tool with that name is skipped.

## Adding secrets

Tool-specific secrets (API keys, URLs) go in `.env` and are gitignored:

```bash
# .env
JIRA_URL=https://yourcompany.atlassian.net
JIRA_TOKEN=Basic_base64...
```

Access them in your tool via `process.env.JIRA_URL`.

## Full example: Jira search tool

```ts
import { defineTool } from '@artificer-ai/runtime';

export default defineTool({
  // snake_case name — this is what the LLM calls
  name: 'search_jira',

  // Describe the return value, not just the action — helps the LLM decide when to use it
  description: 'Search JIRA issues by JQL query. Returns key, summary, and status for matching issues.',

  // JSON Schema for the input object
  input: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'JQL query string, e.g. "project = PAYMENTS AND status = Open"',
      },
    },
    required: ['query'],
  },

  // Worker needs it to look up tickets; planner needs it to scope work
  roles: ['worker', 'planner'],

  async execute(input) {
    const resp = await fetch(`${process.env.JIRA_URL}/rest/api/2/search`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${process.env.JIRA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jql: input.query, maxResults: 10 }),
    });

    // Throw on failure — the runtime surfaces this to the worker for retry/recovery
    if (!resp.ok) {
      throw new Error(`JIRA API error: ${resp.status}`);
    }

    const data = await resp.json() as {
      issues: Array<{ key: string; fields: { summary: string; status: { name: string } } }>;
    };

    // Return structured JSON when the result has multiple fields
    return JSON.stringify(
      data.issues.map(i => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status.name,
      })),
      null,
      2,
    );
  },
});
```

## Verify the tool loaded

At startup, `artificer dev` lists the tools it found and registers them for the live call path. Check the output for your tool name, then trigger a role call and confirm the model can invoke it. If it's missing at startup, check the file path and that it exports a default `defineTool()` call. If it appears at startup but not in a call, check that the tool's `roles` array includes the role you're testing.

## Tips

- Keep `description` specific — the LLM uses it to decide when to call the tool
- Return structured JSON strings when the result has multiple fields; plain text for simple results
- Throw an `Error` if the external call fails — the runtime surfaces it to the worker role for retry/recovery
- Keep tools focused: one tool per external system or operation

## Related docs

- [Core concepts — executors](/docs/getting-started/core-concepts#executors)
- [Custom CLI executors](/docs/guides/custom-cli-executor) — swap the worker role entirely
