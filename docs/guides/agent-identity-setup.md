# Setting Up an Agent Identity Repo

This guide walks through creating a dedicated GitHub account for an Artificer agent and scaffolding its identity repo. The agent gets its own git identity — separate from yours — so its commits, PRs, and activity appear as a distinct person.

## Prerequisites

- Node.js >= 21
- `artificer` CLI installed (`cd packages/cli && pnpm link:global`)
- A new GitHub account for the agent (e.g., `atlas-eng`)

---

## Step 1: Create a GitHub PAT for the Agent Account

Log in to GitHub as the agent account and create a **fine-grained personal access token** at [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta).

### PAT Scoping Checklist

**Token name:** `artificer-runtime` (or whatever helps you identify it)
**Expiration:** 90 days (rotate before expiry)
**Repository access:** All repositories (or limit to specific repos the agent will work on)

**Required permissions:**

| Permission | Access | Why |
|---|---|---|
| **Contents** | Read and write | Clone repos, push commits, read files |
| **Pull requests** | Read and write | Open PRs, comment, merge |
| **Issues** | Read and write | Read assigned issues, comment |
| **Metadata** | Read-only | Required by GitHub for all tokens |

**Optional permissions (enable as needed):**

| Permission | Access | Why |
|---|---|---|
| **Workflows** | Read and write | Trigger or monitor CI/CD workflows |
| **Actions** | Read-only | Check CI status on PRs |
| **Commit statuses** | Read-only | Read check/status results |
| **Webhooks** | Read and write | If the agent manages its own webhook config |

Copy the token — you'll need it for `.env`.

### Agent Profile Setup

While logged in as the agent account:

1. **Display name** — Set to the agent's name (e.g., "Atlas")
2. **Avatar** — Upload a distinctive image so the agent is recognizable in PRs and commits
3. **Bio** — Optional, e.g., "Engineering agent for the payments team. Powered by Artificer."
4. **Noreply email** — Note the account's noreply email from [github.com/settings/emails](https://github.com/settings/emails). It looks like `123456+atlas-eng@users.noreply.github.com`. You'll use this as `GITHUB_USER_EMAIL`.

---

## Step 2: Scaffold the Agent Repo

```bash
artificer init atlas
cd atlas
```

This creates:

```
atlas/
├── artificer.config.ts          # agent configuration
├── agent/
│   ├── instructions.md          # system prompt additions
│   ├── tools/                   # custom tools (defineTool)
│   ├── channels/                # channel adapters (defineChannel)
│   └── skills/                  # on-demand knowledge
├── identity/
│   └── memories/                # agent-written, git-tracked
├── package.json
├── .env                         # secrets (gitignored)
├── .env.example
└── .gitignore                   # ignores .artificer/ and .env
```

---

## Step 3: Configure Credentials

Edit `.env` with the agent's credentials:

```bash
# LLM gateway (required — pick one)
LLM_API_KEY=zen_sk_...                    # OpenCode Zen key
# LLM_API_KEY=sk-ant-...                  # or direct Anthropic key
# LLM_BASE_URL=https://opencode.ai/zen/v1 # default, change for other providers

# Agent GitHub identity
GITHUB_TOKEN=github_pat_...                # PAT from Step 1
GITHUB_USER_NAME=Atlas                     # commit author name
GITHUB_USER_EMAIL=123456+atlas-eng@users.noreply.github.com  # noreply email

# API authentication (optional locally, required in production)
# ARTIFICER_API_KEY=generate-a-random-secret-here

# Channel credentials (add as needed)
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_SIGNING_SECRET=abc123...
```

The `.env` file is gitignored — credentials never enter the repo.

---

## Step 4: Customize the Agent Identity

### Configuration

Edit `artificer.config.ts`:

```ts
import { defineConfig } from '@artificer/runtime';

export default defineConfig({
  name: 'Atlas',
  description: 'Engineering agent for the payments team',
  preset: 'quality-first',
  identity: {
    autoCommit: true,
    autoPush: false,
  },
});
```

### Instructions

Edit `agent/instructions.md` to give the agent standing context:

```markdown
## Team Context

You work with the payments team at Acme Corp. Our main services are:
- `payments-api` — Go service handling payment processing
- `payments-web` — React dashboard for payment management

When opening PRs, always tag @payments-reviewers.
```

### Custom Tools (optional)

Add tools to `agent/tools/`. Example — `agent/tools/search-jira.ts`:

```ts
import { defineTool } from '@artificer/runtime';

export default defineTool({
  name: 'search_jira',
  description: 'Search JIRA issues by query',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'JQL query' },
    },
    required: ['query'],
  },
  roles: ['worker', 'planner'],
  async execute(input) {
    const resp = await fetch(`${process.env.JIRA_URL}/rest/api/2/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${process.env.JIRA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jql: input.query, maxResults: 10 }),
    });
    const data = await resp.json();
    return JSON.stringify(data.issues.map((i: any) => ({
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status.name,
    })));
  },
});
```

---

## Step 5: Create the Remote Repo

### Option A: Using `gh` CLI (logged in as the agent account)

```bash
gh auth login                    # authenticate as the agent account
git init
git add .
git commit -m "Initial agent identity"
gh repo create atlas --private --source=. --push
```

### Option B: Create in GitHub UI, push locally

1. Log in as the agent account on github.com
2. Create a new private repo (e.g., `atlas`)
3. Push from your local machine:

```bash
git init
git add .
git commit -m "Initial agent identity"
git remote add origin https://github.com/atlas-eng/atlas.git
git push -u origin main
```

For the push to authenticate as the agent, you can use the PAT in the URL:
```bash
git remote set-url origin https://atlas-eng:github_pat_...@github.com/atlas-eng/atlas.git
```

Or configure a credential helper scoped to this repo.

> **Note:** The runtime's `buildGitEnv` injects the agent's PAT automatically when tools run git commands. The manual push above is a one-time setup step — after this, the runtime handles auth.

---

## Step 6: Start the Runtime

```bash
artificer dev
```

You should see:

```
[artificer] Starting Atlas in dev mode
[artificer] Atlas listening on http://localhost:4100
[artificer] identity: /Users/you/atlas
[artificer] execution: /Users/you/atlas/.artificer
```

- **UI:** http://localhost:4100
- **API:** http://localhost:4100/api
- **SSE:** http://localhost:4100/events

---

## Verifying the Identity Split

After the agent does some work (clones a repo, makes commits, opens a PR):

1. **Commits** should show the agent's name and email, not yours
2. **PRs** should be opened by the agent's GitHub account
3. **Memories** written by the agent appear in `identity/memories/` as markdown files
4. **Execution state** (messages, workstreams, runs) lives in `.artificer/` and is gitignored

Check the agent's commit identity:
```bash
cd .artificer/workspace/<workstream-id>/<repo>/
git log --format="%an <%ae>" -1
# Should show: Atlas <123456+atlas-eng@users.noreply.github.com>
```

---

## Production Deployment

For production, set `ARTIFICER_API_KEY` and use `artificer start`:

```bash
# Generate a secret
export ARTIFICER_API_KEY=$(openssl rand -hex 32)

artificer start
```

The API now requires `Authorization: Bearer <key>` on all `/api/*` routes. The UI at `/` is unauthenticated (it includes the key in API calls client-side).

Clone the agent repo on a new machine, provide a fresh `.env`, and the same agent identity runs in a new environment — that's the portability of agent-as-a-repo.
