# Setting Up an Agent Identity Repo

This guide walks through creating a dedicated GitHub account for an Artificer agent and scaffolding its identity repo. The agent gets its own git identity — separate from yours — so its commits, PRs, and activity appear as a distinct person.

## Before you start

You will need:

- **Node.js 21+**
- **The Artificer CLI** installed globally:
  ```bash
  npm install -g @artificer-ai/cli
  ```
- **A GitHub account for the agent** (e.g. `atlas-eng`) — not your personal account

---

## 1. Create a GitHub token for the agent

Log in to GitHub as the agent account and create a **fine-grained personal access token** at [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta).

### Token settings

| Setting | Recommendation |
|---------|----------------|
| Token name | `artificer-runtime` (or anything you'll recognize) |
| Expiration | 90 days — rotate before it expires |
| Repository access | All repositories, or only repos the agent will work on |

**Required permissions:**

| Permission | Access | Why |
|------------|--------|-----|
| Contents | Read and write | Clone repos, push commits, read files |
| Pull requests | Read and write | Open PRs, comment, merge |
| Issues | Read and write | Read assigned issues, comment |
| Metadata | Read-only | Required by GitHub for all tokens |

**Optional permissions (enable as needed):**

| Permission | Access | Why |
|------------|--------|-----|
| Workflows | Read and write | Trigger or monitor CI/CD workflows |
| Actions | Read-only | Check CI status on PRs |
| Commit statuses | Read-only | Read check/status results |
| Webhooks | Read and write | If the agent manages its own webhook config |

Copy the token — you'll add it to `.env` in a later step.

### Set up the agent's GitHub profile

While logged in as the agent account:

1. **Display name** — e.g. "Atlas"
2. **Avatar** — something distinctive so the agent is recognizable in PRs and commits
3. **Bio** — optional, e.g. "Engineering agent for the payments team"
4. **Noreply email** — from [github.com/settings/emails](https://github.com/settings/emails). It looks like `123456+atlas-eng@users.noreply.github.com`. You'll use this as `GITHUB_USER_EMAIL`.

---

## 2. Scaffold the agent project

```bash
artificer init atlas
cd atlas
npm install
```

This creates:

```
atlas/
├── artificer.config.json      # agent configuration
├── agent/
│   ├── instructions.md        # standing context for the agent
│   ├── tools/                 # custom tools
│   ├── channels/              # Slack, Discord, etc.
│   └── skills/                # on-demand knowledge
├── identity/
│   └── memories/              # agent-written, git-tracked
├── package.json
├── .env                       # secrets (gitignored)
├── .env.example
└── .gitignore
```

---

## 3. Configure credentials

Edit `.env` with the agent's secrets:

```bash
# LLM gateway (required)
LLM_API_KEY=zen_sk_...
# LLM_BASE_URL=https://opencode.ai/zen/v1   # default; override for other providers

# Agent GitHub identity
GITHUB_TOKEN=github_pat_...
GITHUB_USER_NAME=Atlas
GITHUB_USER_EMAIL=123456+atlas-eng@users.noreply.github.com

# API authentication (optional locally, required in production)
# ARTIFICER_API_KEY=

# Channel credentials (add when connecting Slack/Discord — see guide below)
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_SIGNING_SECRET=...
```

The `.env` file is gitignored — credentials never enter the repo.

---

## 4. Customize the agent

### Configuration

Edit `artificer.config.json`:

```json
{
  "name": "Atlas",
  "description": "Engineering agent for the payments team",
  "preset": "quality-first",
  "identity": {
    "autoCommit": true,
    "autoPush": false
  }
}
```

Your editor should offer autocomplete if the `$schema` path in the file resolves to `@artificer-ai/runtime`.

### Instructions

Edit `agent/instructions.md` to give the agent standing context:

```markdown
## Team Context

You work with the payments team at Acme Corp. Our main services are:
- `payments-api` — Go service handling payment processing
- `payments-web` — React dashboard for payment management

When opening PRs, always tag @payments-reviewers.
```

### Custom tools (optional)

Add tools to `agent/tools/`. Example — `agent/tools/search-jira.ts`:

```ts
import { defineTool } from '@artificer-ai/runtime';

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
        Authorization: `Basic ${process.env.JIRA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jql: input.query, maxResults: 10 }),
    });
    const data = await resp.json();
    return JSON.stringify(
      data.issues.map((i: { key: string; fields: { summary: string; status: { name: string } } }) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status.name,
      })),
    );
  },
});
```

Add any tool-specific secrets (like `JIRA_TOKEN`) to `.env`.

---

## 5. Push to GitHub

Create a remote repo for the agent identity and push the initial commit.

### Option A: Using the GitHub CLI

Authenticate as the agent account, then:

```bash
gh auth login
git init
git add .
git commit -m "Initial agent identity"
gh repo create atlas --private --source=. --push
```

### Option B: Create the repo in the GitHub UI

1. Log in as the agent account on github.com
2. Create a new private repo (e.g. `atlas`)
3. Push from your machine:

```bash
git init
git add .
git commit -m "Initial agent identity"
git remote add origin https://github.com/atlas-eng/atlas.git
git push -u origin main
```

To authenticate the one-time push as the agent, you can embed the PAT in the remote URL:

```bash
git remote set-url origin https://atlas-eng:github_pat_...@github.com/atlas-eng/atlas.git
```

After setup, the runtime injects the agent's PAT automatically when git tools run — you only need to do this for the initial push.

---

## 6. Start the agent

```bash
artificer dev
```

You should see:

```
[artificer] Atlas ready

  API   http://localhost:4100/api
  UI    http://localhost:4100
  SSE   http://localhost:4100/events

  identity  /Users/you/atlas
  exec      /Users/you/.artificer/Atlas
```

Open **http://localhost:4100** in your browser to interact with the agent, view workstreams, and monitor activity.

For verbose logging:

```bash
ARTIFICER_VERBOSE=true artificer dev
```

---

## Verify the identity split

After the agent clones a repo, makes commits, or opens a PR:

1. **Commits** show the agent's name and email, not yours
2. **PRs** are opened by the agent's GitHub account
3. **Memories** the agent writes appear in `identity/memories/` as markdown files
4. **Execution state** (messages, workstreams, workspace checkouts) lives in `~/.artificer/<agent-name>/` by default — separate from the identity repo

To confirm commit authorship inside a workstream workspace:

```bash
cd ~/.artificer/Atlas/workspace/<workstream-id>/<repo>/
git log --format="%an <%ae>" -1
# Atlas <123456+atlas-eng@users.noreply.github.com>
```

If you prefer execution data inside the project directory, set `ARTIFICER_EXEC_DIR=./.artificer` in `.env` and uncomment `.artificer/` in `.gitignore`.

---

## Production deployment

For production, protect the API and run in start mode:

```bash
# Add to .env
ARTIFICER_API_KEY=<output of: openssl rand -hex 32>

artificer start
```

All `/api/*` routes then require `Authorization: Bearer <key>`. The web UI at `/` handles this client-side.

To run the same agent elsewhere, clone the identity repo, copy `.env` (or recreate the secrets), run `npm install`, and `artificer start`. That's the portability of agent-as-a-repo.

---

## Next steps

- [Connect Slack & Discord](./slack-discord-connections.md) — let your team message the agent in chat

---

## Environment variables reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `LLM_API_KEY` | Yes | LLM gateway API key |
| `GITHUB_TOKEN` | For git/PR work | Agent's GitHub PAT |
| `GITHUB_USER_NAME` | For git/PR work | Commit author name |
| `GITHUB_USER_EMAIL` | For git/PR work | Commit author email (use noreply) |
| `ARTIFICER_API_KEY` | Production | API bearer token |
| `ARTIFICER_EXEC_DIR` | No | Override execution data location |
| `PORT` | No | HTTP port (default `4100`) |
