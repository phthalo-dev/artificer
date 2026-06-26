# Public API Surface: Agent-as-a-Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Artificer's public API surface and "agent as a repo" model — the agent's identity (config, tools, skills, memories, instructions) lives as files in a git repo, separate from ephemeral execution state. Both users and the agent itself can modify these identity files. The repo is portable across execution environments.

**Architecture:** An Artificer agent is a git repository with a conventional directory structure. The runtime reads the repo to boot, and writes identity changes (new memories, learned skills, config mutations) back as file changes the agent can commit and push. Execution state (messages, workstreams, runs) lives in a separate ephemeral directory. A `defineConfig` + `define*` API provides typed authoring. A CLI handles discovery and startup.

**Tech Stack:** TypeScript, Zod (already transitive via AI SDK), Hono (existing), Vercel AI SDK (existing), Node.js native test runner.

## Global Constraints

- Node.js ≥ 21, pnpm 8, Turborepo
- No new runtime dependencies beyond Zod
- Existing tests must continue to pass
- The deterministic state machine (`nextWorkstreamAction`) is not exposed for override in this phase
- All `define*` functions exported from `@artificer/runtime`
- **Secrets in `.env` only** — API keys, tokens, signing secrets, and all credentials live in `.env` (gitignored). Tools and channels reference them via `process.env`. The agent repo never contains secrets. This applies to: LLM gateway keys (`LLM_API_KEY`), GitHub tokens (`GITHUB_TOKEN`), and any connection credentials (e.g. `JIRA_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`).
- **`GIT_CEILING_DIRECTORIES` for workspace isolation** — all git operations in `.artificer/workspace/` must set `GIT_CEILING_DIRECTORIES` to prevent git from walking up the tree into the agent identity repo. Without this, git commands in an empty workspace (pre-clone) would operate on the agent's own repo. Specifically, `packages/runtime/src/tools/git-env.ts:buildGitEnv()` must be updated to accept a `workspaceDir` parameter and set `GIT_CEILING_DIRECTORIES` to its parent directory. This also affects `shell-policy.ts` and anywhere `buildGitEnv` is called.

---

## Developer Experience

Before the implementation tasks, here is the end-to-end experience this plan produces. Every task below serves this DX.

### What the user creates

```
my-agent/                              # ← this IS the git repo
├── artificer.config.ts                # typed config (model, preset, github, etc.)
├── agent/
│   ├── instructions.md                # additional system prompt content
│   ├── tools/
│   │   └── search-jira.ts            # defineTool({ ... })
│   ├── channels/
│   │   └── slack.ts                  # defineChannel({ ... })
│   └── skills/
│       └── code-review.md            # knowledge the agent can load on demand
├── identity/
│   ├── memories/                      # agent-written, git-tracked
│   │   ├── preference_abc123.md       # "always use TDD in this repo"
│   │   ├── note_def456.md            # "JIRA-123 was about the auth flow"
│   │   └── document_ghi789.md        # distilled API docs
│   └── index.json                     # memory search index
├── package.json
├── .env                               # secrets (gitignored)
└── .gitignore                         # ignores .artificer/ and .env
```

### Secrets and credentials

All secrets live in `.env` at the repo root (gitignored). The agent repo never contains credentials — it's safe to push, share, and clone.

```bash
# .env — NEVER committed
LLM_API_KEY=zen_sk_...                  # LLM gateway key
GITHUB_TOKEN=ghp_...                    # Agent's GitHub PAT
GITHUB_USER_NAME=atlas-bot
GITHUB_USER_EMAIL=atlas-bot@users.noreply.github.com

# Connection credentials (used by custom tools and channels)
JIRA_URL=https://acme.atlassian.net
JIRA_TOKEN=base64_email:api_token
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=abc123...
LINEAR_API_KEY=lin_api_...
```

Custom tools reference these via `process.env.JIRA_TOKEN` etc. (see the `search-jira.ts` example below). Channel adapters use them for webhook verification and API calls. When deploying to a new environment, you bring the agent repo (git clone) and provide a fresh `.env` — same agent identity, different credentials.

Future connection abstraction (`defineConnection`) will formalize this pattern with managed OAuth, token refresh, and credential brokering (the runtime injects secrets at the HTTP layer so the LLM never sees raw tokens in tool results).

### What the runtime creates at execution time (ephemeral, gitignored)

```
.artificer/                            # execution state, NOT in git
├── messages/                          # conversation log
├── workstreams/                       # active work + tasks + reviews
│   └── ws_abc123/
│       ├── workstream.json
│       ├── tasks/
│       ├── reviews/
│       ├── findings/
│       └── plan.md
├── runs/                              # LLM call records
├── workspace/                         # cloned repos for workstreams
├── tool-results/                      # spilled large tool outputs
└── github-watch-state.json            # polling cursor
```

### What the user writes

**`artificer.config.ts`** — the only required file:

```ts
import { defineConfig } from '@artificer/runtime';

export default defineConfig({
  name: 'Atlas',
  description: 'Engineering agent for the payments team',

  // Model configuration — pick a preset or set tiers directly
  preset: 'quality-first',
  // Or override individual tiers:
  // models: {
  //   low: 'claude-haiku-4-5-20251001',
  //   medium: 'claude-sonnet-4-6',
  //   high: 'claude-opus-4-8',
  // },

  // Override which model tier a role uses
  roleTiers: {
    communicator: 'low',
    planner: 'high',
  },

  // GitHub identity for the agent
  github: {
    watchInterval: '5m',
  },

  // Runtime tuning
  concurrency: 3,
  maxIterationsPerCall: 30,

  // Identity settings
  identity: {
    // Auto-commit identity changes (memories, skills, config)
    autoCommit: true,
    // Auto-push after committing
    autoPush: false,
    // Commit message prefix
    commitPrefix: '[atlas]',
  },
});
```

**`agent/tools/search-jira.ts`** — a custom tool:

```ts
import { defineTool } from '@artificer/runtime';

export default defineTool({
  name: 'search_jira',
  description: 'Search JIRA issues by query',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'JQL query' },
      maxResults: { type: 'number', description: 'Max results (default 10)' },
    },
    required: ['query'],
  },
  roles: ['worker', 'planner', 'communicator'],
  async execute(input, ctx) {
    const resp = await fetch(`${process.env.JIRA_URL}/rest/api/2/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${process.env.JIRA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql: input.query,
        maxResults: input.maxResults ?? 10,
      }),
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

**`agent/channels/slack.ts`** — a channel adapter:

```ts
import { defineChannel } from '@artificer/runtime';

export default defineChannel({
  name: 'slack',
  description: 'Slack workspace integration',
  verify: async (headers, body) => {
    // Verify Slack signing secret
    return verifySlackSignature(headers, body, process.env.SLACK_SIGNING_SECRET!);
  },
  receive: async (payload) => ({
    content: payload.event?.text ?? '',
    metadata: {
      channel: 'slack',
      channelId: payload.event?.channel,
      threadTs: payload.event?.thread_ts,
      userId: payload.event?.user,
    },
  }),
  format: async (output) => ({
    text: output.content,
    channel: output.metadata?.channelId,
    thread_ts: output.metadata?.threadTs,
  }),
});
```

**`agent/instructions.md`** — system prompt additions:

```markdown
## Team Context

You work with the payments team at Acme Corp. Our main services are:
- `payments-api` — Go service handling payment processing
- `payments-web` — React dashboard for payment management

When opening PRs, always tag @payments-reviewers.
Always check JIRA for related tickets before starting work.
```

**`agent/skills/code-review.md`** — on-demand knowledge:

```markdown
# Code Review Standards

When reviewing payments code:
1. Check for PCI compliance — no card numbers in logs
2. All money amounts must use the `Money` type, never floats
3. Database transactions must use the `WithTx` helper
4. API changes need a migration plan in the PR description
```

### How the user runs it

```bash
# Scaffold a new agent
npx @artificer/cli init my-agent

# Local development (discovers agent/, hot-reloads on file changes)
artificer dev

# Production
artificer start

# Or programmatically (escape hatch for advanced users)
npx tsx main.ts
```

### What the agent can do to itself

The agent, through its existing `write_file` and `edit_file` tools (scoped to its own identity directory), can:

1. **Add memories** — the librarian/communicator writes markdown files to `identity/memories/` and updates `identity/index.json`. This replaces the current JSON-blob memory store.

2. **Add skills** — after learning something substantial (via the librarian reading docs), the agent can write a skill file to `agent/skills/` so it's available for future sessions.

3. **Add tools** — the agent can write a new `defineTool` file to `agent/tools/`. The tool becomes available on next restart (or hot-reload in dev mode).

4. **Update instructions** — the agent can append to `agent/instructions.md` when it learns standing context about the team or codebase.

5. **Auto-commit** — when `identity.autoCommit` is enabled, the runtime watches for identity file changes and commits them with a descriptive message. If `autoPush` is also on, it pushes to the remote.

This means the agent's evolution is version-controlled. You can `git log` its memory growth, `git revert` a bad learning, or `git clone` the repo onto a new machine and have the same agent.

### Programmatic escape hatch

For users who need full control (or want to embed the runtime):

```ts
// main.ts — optional, replaces the CLI
import { createRuntime, defineTool } from '@artificer/runtime';

const runtime = await createRuntime({
  agentDir: './agent',
  configPath: './artificer.config.ts',
});

// Or fully programmatic:
const runtime = await createRuntime({
  name: 'Atlas',
  preset: 'quality-first',
  tools: [
    defineTool({ name: 'my_tool', /* ... */ }),
  ],
});

await runtime.start();
```

---

## Implementation Tasks

### Task 1: Identity/Execution Storage Split

Separate the `Store` and `Layout` into two layers: an `IdentityStore` for git-tracked agent identity (memories, config), and the existing `Store` for ephemeral execution state. This is foundational — everything else depends on it.

**Files:**
- Create: `packages/runtime/src/storage/identity-store.ts`
- Create: `packages/runtime/src/storage/identity-layout.ts`
- Modify: `packages/runtime/src/storage/layout.ts:1-102` (remove `memoriesDir`, `memoryFile`, `memoryIndexFile` — moved to identity layer)
- Modify: `packages/runtime/src/storage/store.ts:111-127` (update `init` to not create memoriesDir, delegate memory ops to IdentityStore)
- Modify: `packages/runtime/src/config.ts:27-72` (add `identityDir` to RuntimeConfig)
- Test: `packages/runtime/src/storage/identity-store.test.ts`

**Interfaces:**
- Consumes: `Memory` type from `storage/types.ts`, `rankMemories` from `memory-search.ts`
- Produces: `IdentityLayout` class with paths rooted at the agent repo root: `memoriesDir`, `memoryFile(id)`, `memoryIndexFile()`, `skillsDir`, `toolsDir`, `channelsDir`, `instructionsFile`, `configFile`. `IdentityStore` class with memory CRUD methods (same interface as Store's current memory methods, but writing markdown files instead of JSON), plus `listSkills()`, `readInstructions()`. The existing `Store` keeps a reference to `IdentityStore` and delegates memory calls.

- [ ] **Step 1: Write the failing test for `IdentityLayout`**

```ts
// packages/runtime/src/storage/identity-store.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { IdentityLayout } from './identity-layout.js';

describe('IdentityLayout', () => {
  it('resolves identity paths relative to agent root', () => {
    const layout = new IdentityLayout('/home/user/my-agent');

    assert.equal(layout.memoriesDir, '/home/user/my-agent/identity/memories');
    assert.equal(layout.skillsDir, '/home/user/my-agent/agent/skills');
    assert.equal(layout.toolsDir, '/home/user/my-agent/agent/tools');
    assert.equal(layout.channelsDir, '/home/user/my-agent/agent/channels');
    assert.equal(
      layout.instructionsFile,
      '/home/user/my-agent/agent/instructions.md',
    );
    assert.equal(
      layout.configFile,
      '/home/user/my-agent/artificer.config.ts',
    );
  });

  it('resolves memory file paths', () => {
    const layout = new IdentityLayout('/home/user/my-agent');
    const memPath = layout.memoryFile('pref_abc123');

    assert.equal(
      memPath,
      '/home/user/my-agent/identity/memories/pref_abc123.md',
    );
  });

  it('resolves memory index path', () => {
    const layout = new IdentityLayout('/home/user/my-agent');
    assert.equal(
      layout.memoryIndexFile,
      '/home/user/my-agent/identity/index.json',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/storage/identity-store.test.ts`
Expected: FAIL — module `./identity-layout.js` not found

- [ ] **Step 3: Implement `IdentityLayout`**

```ts
// packages/runtime/src/storage/identity-layout.ts
import path from 'node:path';

export class IdentityLayout {
  constructor(public readonly root: string) {}

  get memoriesDir(): string {
    return path.join(this.root, 'identity', 'memories');
  }

  get memoryIndexFile(): string {
    return path.join(this.root, 'identity', 'index.json');
  }

  memoryFile(id: string): string {
    return path.join(this.memoriesDir, `${id}.md`);
  }

  get skillsDir(): string {
    return path.join(this.root, 'agent', 'skills');
  }

  get toolsDir(): string {
    return path.join(this.root, 'agent', 'tools');
  }

  get channelsDir(): string {
    return path.join(this.root, 'agent', 'channels');
  }

  get instructionsFile(): string {
    return path.join(this.root, 'agent', 'instructions.md');
  }

  get configFile(): string {
    return path.join(this.root, 'artificer.config.ts');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && npx tsx --test src/storage/identity-store.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Write failing test for `IdentityStore` memory operations**

```ts
// packages/runtime/src/storage/identity-store.test.ts (append)
import fs from 'node:fs';
import os from 'node:os';
import { IdentityStore } from './identity-store.js';

describe('IdentityStore', () => {
  let tmpDir: string;
  let store: IdentityStore;

  beforeEach(async () => {
    const { beforeEach: _ } = await import('node:test');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-identity-'));
    store = new IdentityStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a memory as a markdown file', async () => {
    const memory = await store.addMemory({
      content: 'Always use TDD in the payments repo',
      title: 'TDD preference',
      tags: ['preference', 'payments'],
      kind: 'preference',
      source: 'conversation',
    });

    assert.ok(memory.id);
    assert.equal(memory.title, 'TDD preference');

    // Verify the file exists and is markdown
    const filePath = store.layout.memoryFile(memory.id);
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('Always use TDD'));
    assert.ok(content.includes('tags:'));
  });

  it('queries memories by keyword', async () => {
    await store.addMemory({
      content: 'The auth service uses JWT tokens',
      title: 'Auth architecture',
      tags: ['architecture'],
      kind: 'note',
    });
    await store.addMemory({
      content: 'Deploy to staging before prod',
      title: 'Deploy process',
      tags: ['process'],
      kind: 'note',
    });

    const results = await store.queryMemories('auth JWT');
    assert.ok(results.length >= 1);
    assert.ok(results[0].title?.includes('Auth'));
  });

  it('lists all memories', async () => {
    await store.addMemory({
      content: 'Fact one',
      title: 'One',
      tags: [],
      kind: 'note',
    });
    await store.addMemory({
      content: 'Fact two',
      title: 'Two',
      tags: [],
      kind: 'note',
    });

    const all = await store.listMemories();
    assert.equal(all.length, 2);
  });
});
```

Add `beforeEach` and `afterEach` imports at the top of the file:

```ts
import { describe, it, beforeEach, afterEach } from 'node:test';
```

- [ ] **Step 6: Implement `IdentityStore`**

```ts
// packages/runtime/src/storage/identity-store.ts
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IdentityLayout } from './identity-layout.js';
import { rankMemories, type MemoryIndexEntry } from './memory-search.js';
import type { Memory } from './types.js';

function now(): string {
  return new Date().toISOString();
}

function newMemoryId(kind: string): string {
  return `${kind}_${randomUUID().slice(0, 8)}`;
}

interface MemoryFrontmatter {
  id: string;
  title?: string;
  summary?: string;
  tags: string[];
  kind: string;
  source?: string;
  createdAt: string;
  updatedAt?: string;
}

function memoryToMarkdown(memory: Memory): string {
  const fm: MemoryFrontmatter = {
    id: memory.id,
    title: memory.title,
    summary: memory.summary,
    tags: memory.tags,
    kind: memory.kind ?? 'note',
    source: memory.source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
  const frontmatter = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((t) => `"${t}"`).join(', ')}]`;
      return `${k}: "${v}"`;
    })
    .join('\n');

  return `---\n${frontmatter}\n---\n\n${memory.content}\n`;
}

function markdownToMemory(filePath: string, raw: string): Memory | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const fmBlock = fmMatch[1];
  const content = fmMatch[2].trim();

  const get = (key: string): string | undefined => {
    const m = fmBlock.match(new RegExp(`^${key}:\\s*"(.*)"`, 'm'));
    return m?.[1];
  };
  const getTags = (): string[] => {
    const m = fmBlock.match(/^tags:\s*\[(.*)\]/m);
    if (!m) return [];
    return m[1]
      .split(',')
      .map((t) => t.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  };

  const id = get('id') ?? path.basename(filePath, '.md');

  return {
    id,
    content,
    title: get('title'),
    summary: get('summary'),
    tags: getTags(),
    kind: (get('kind') as Memory['kind']) ?? 'note',
    source: get('source'),
    createdAt: get('createdAt') ?? now(),
    updatedAt: get('updatedAt'),
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export class IdentityStore {
  readonly layout: IdentityLayout;

  constructor(rootDir: string) {
    this.layout = new IdentityLayout(rootDir);
  }

  async init(): Promise<void> {
    await ensureDir(this.layout.memoriesDir);
  }

  async addMemory(
    input: Omit<Memory, 'id' | 'createdAt'>,
  ): Promise<Memory> {
    const memory: Memory = {
      id: newMemoryId(input.kind ?? 'note'),
      createdAt: now(),
      ...input,
    };

    await fs.writeFile(
      this.layout.memoryFile(memory.id),
      memoryToMarkdown(memory),
      'utf-8',
    );
    await this.rebuildIndex();
    return memory;
  }

  async getMemory(id: string): Promise<Memory | null> {
    try {
      const raw = await fs.readFile(this.layout.memoryFile(id), 'utf-8');
      return markdownToMemory(this.layout.memoryFile(id), raw);
    } catch {
      return null;
    }
  }

  async listMemories(): Promise<Memory[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.layout.memoriesDir);
    } catch {
      return [];
    }

    const memories: Memory[] = [];
    for (const f of entries.filter((f) => f.endsWith('.md')).sort()) {
      const filePath = path.join(this.layout.memoriesDir, f);
      const raw = await fs.readFile(filePath, 'utf-8');
      const memory = markdownToMemory(filePath, raw);
      if (memory) memories.push(memory);
    }
    return memories;
  }

  async queryMemories(query: string, limit = 10): Promise<Memory[]> {
    const all = await this.listMemories();
    const index: MemoryIndexEntry[] = all.map((m) => ({
      id: m.id,
      title: m.title ?? '',
      summary: m.summary ?? m.content.slice(0, 200),
      tags: m.tags,
    }));
    const ranked = rankMemories(index, query, limit);
    const idSet = new Set(ranked.map((r) => r.id));
    return all.filter((m) => idSet.has(m.id));
  }

  async deleteMemory(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.layout.memoryFile(id));
      await this.rebuildIndex();
      return true;
    } catch {
      return false;
    }
  }

  private async rebuildIndex(): Promise<void> {
    const all = await this.listMemories();
    const index: MemoryIndexEntry[] = all.map((m) => ({
      id: m.id,
      title: m.title ?? '',
      summary: m.summary ?? m.content.slice(0, 200),
      tags: m.tags,
    }));
    await fs.writeFile(
      this.layout.memoryIndexFile,
      JSON.stringify(index, null, 2),
      'utf-8',
    );
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/storage/identity-store.test.ts`
Expected: PASS — all 6 tests green

- [ ] **Step 8: Add `identityDir` to `RuntimeConfig`**

Modify `packages/runtime/src/config.ts` — add `identityDir` field to the `RuntimeConfig` interface and its resolution in `loadConfig`:

```ts
// In RuntimeConfig interface, add:
/** Root directory of the agent identity repo (config, tools, memories). */
identityDir: string;

// In loadConfig(), add resolution:
const identityDir = env.ARTIFICER_IDENTITY_DIR
  ? path.resolve(env.ARTIFICER_IDENTITY_DIR)
  : path.resolve(process.cwd());
// Add to return object:
identityDir,
```

- [ ] **Step 9: Run full test suite**

Run: `cd packages/runtime && npm test`
Expected: All existing tests pass, new tests pass

- [ ] **Step 10: Commit**

```bash
git add packages/runtime/src/storage/identity-layout.ts packages/runtime/src/storage/identity-store.ts packages/runtime/src/storage/identity-store.test.ts packages/runtime/src/config.ts
git commit -m "feat(runtime): add identity/execution storage split with markdown memories"
```

---

### Task 2: `defineConfig` — Typed Agent Configuration

The top-level configuration function for `artificer.config.ts`. Replaces env-var-only configuration with a typed, discoverable config surface.

**Files:**
- Create: `packages/runtime/src/api/define-config.ts`
- Create: `packages/runtime/src/api/types.ts`
- Modify: `packages/runtime/src/config.ts:96-206` (add `mergeWithDefinition` to layer config file over env vars)
- Modify: `packages/runtime/src/index.ts` (add exports)
- Test: `packages/runtime/src/api/define-config.test.ts`

**Interfaces:**
- Consumes: `RuntimeConfig` from `config.ts`, `ModelTiers` from `engine/models.ts`, `RoleName` from `storage/types.ts`
- Produces: `defineConfig(definition: ArtificerConfig): ArtificerConfig` — a pure identity function that provides type checking and IntelliSense. The returned object is loaded by the CLI or `createRuntime` and merged with env var overrides (env vars win over config file, config file wins over defaults).

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/api/define-config.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineConfig } from './define-config.js';

describe('defineConfig', () => {
  it('returns the config object unchanged (identity function for type safety)', () => {
    const config = defineConfig({
      name: 'Atlas',
      description: 'Payments team agent',
    });

    assert.equal(config.name, 'Atlas');
    assert.equal(config.description, 'Payments team agent');
  });

  it('accepts full configuration', () => {
    const config = defineConfig({
      name: 'Atlas',
      preset: 'quality-first',
      models: {
        low: 'claude-haiku-4-5-20251001',
        medium: 'claude-sonnet-4-6',
        high: 'claude-opus-4-8',
      },
      roleTiers: {
        communicator: 'low',
        planner: 'high',
      },
      github: {
        watchInterval: '5m',
      },
      concurrency: 3,
      identity: {
        autoCommit: true,
        autoPush: false,
        commitPrefix: '[atlas]',
      },
    });

    assert.equal(config.preset, 'quality-first');
    assert.equal(config.models?.high, 'claude-opus-4-8');
    assert.equal(config.roleTiers?.communicator, 'low');
    assert.equal(config.concurrency, 3);
    assert.equal(config.identity?.autoCommit, true);
    assert.equal(config.github?.watchInterval, '5m');
  });

  it('works with minimal config (only name)', () => {
    const config = defineConfig({ name: 'Bot' });
    assert.equal(config.name, 'Bot');
    assert.equal(config.preset, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/api/define-config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create types file**

```ts
// packages/runtime/src/api/types.ts
import type { ModelTier, ModelTiers } from '../engine/models.js';
import type { RoleName } from '../storage/types.js';

export interface IdentityConfig {
  autoCommit?: boolean;
  autoPush?: boolean;
  commitPrefix?: string;
}

export interface GitHubShorthand {
  watchInterval?: string;
}

export interface ArtificerConfig {
  name: string;
  description?: string;
  preset?: string;
  models?: Partial<ModelTiers>;
  roleTiers?: Partial<Record<RoleName, ModelTier>>;
  github?: GitHubShorthand;
  concurrency?: number;
  maxIterationsPerCall?: number;
  port?: number;
  dataDir?: string;
  identity?: IdentityConfig;
}
```

- [ ] **Step 4: Implement `defineConfig`**

```ts
// packages/runtime/src/api/define-config.ts
import type { ArtificerConfig } from './types.js';

export function defineConfig(config: ArtificerConfig): ArtificerConfig {
  return config;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/runtime && npx tsx --test src/api/define-config.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 6: Add `mergeWithDefinition` to config.ts**

Add a function that layers an `ArtificerConfig` over the defaults, then lets env vars override both:

```ts
// packages/runtime/src/config.ts (add new exported function)
import type { ArtificerConfig } from './api/types.js';

function parseInterval(s: string): number | undefined {
  const m = s.match(/^(\d+)(ms|s|m|h)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'ms': return n;
    case 's': return n * 1000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    default: return undefined;
  }
}

export function mergeWithDefinition(
  definition: ArtificerConfig,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const base = loadConfig(env);

  return {
    ...base,
    agentName: env.AGENT_NAME ?? definition.name ?? base.agentName,
    models: {
      low: env.LLM_MODEL_LOW ?? definition.models?.low ?? base.models.low,
      medium: env.LLM_MODEL ?? definition.models?.medium ?? base.models.medium,
      high: env.LLM_MODEL_HIGH ?? definition.models?.high ?? base.models.high,
    },
    roleTiers: {
      ...base.roleTiers,
      ...definition.roleTiers,
    },
    concurrency: env.RUNTIME_CONCURRENCY
      ? Number(env.RUNTIME_CONCURRENCY)
      : definition.concurrency ?? base.concurrency,
    maxIterationsPerCall: env.RUNTIME_MAX_ITERATIONS
      ? Number(env.RUNTIME_MAX_ITERATIONS)
      : definition.maxIterationsPerCall ?? base.maxIterationsPerCall,
    port: env.PORT ? Number(env.PORT) : definition.port ?? base.port,
    github: base.github
      ? {
          ...base.github,
          watchIntervalMs: base.github.watchIntervalMs ??
            (definition.github?.watchInterval
              ? parseInterval(definition.github.watchInterval)
              : undefined),
        }
      : undefined,
  } as RuntimeConfig;
}
```

- [ ] **Step 7: Export from index.ts**

Add to `packages/runtime/src/index.ts`:

```ts
export { defineConfig } from './api/define-config.js';
export { mergeWithDefinition } from './config.js';
export type { ArtificerConfig, IdentityConfig } from './api/types.js';
```

- [ ] **Step 8: Run full test suite**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add packages/runtime/src/api/define-config.ts packages/runtime/src/api/define-config.test.ts packages/runtime/src/api/types.ts packages/runtime/src/config.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add defineConfig for typed agent configuration"
```

---

### Task 3: `defineTool` — Public Tool Definition API

Custom tools that both users and the agent itself can author. The agent writes these same `defineTool` files to `agent/tools/` to extend its own capabilities.

**Files:**
- Create: `packages/runtime/src/api/define-tool.ts`
- Modify: `packages/runtime/src/api/types.ts` (add tool types)
- Create: `packages/runtime/src/api/tool-registry.ts`
- Modify: `packages/runtime/src/tools/registry.ts:28-115` (accept custom registry)
- Modify: `packages/runtime/src/index.ts` (add exports)
- Test: `packages/runtime/src/api/define-tool.test.ts`

**Interfaces:**
- Consumes: `ToolDef` from `llm/types.ts`, `ToolContext` from `context.ts`, `RoleName` from `storage/types.ts`
- Produces: `defineTool(definition: ToolDefinition): ArtificerTool` — creates a tool from a typed definition. `ToolRegistry` class that holds custom tools and merges them into the built-in `toolsForRole` output. The `roles` field on `ToolDefinition` determines which roles can use the tool (defaults to all).

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/api/define-tool.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineTool } from './define-tool.js';
import { ToolRegistry } from './tool-registry.js';

describe('defineTool', () => {
  it('creates a tool with name and description', () => {
    const tool = defineTool({
      name: 'get_weather',
      description: 'Get weather for a city',
      input: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      execute: async (input) => `Sunny in ${input.city}`,
    });

    assert.equal(tool.name, 'get_weather');
    assert.equal(tool.definition.description, 'Get weather for a city');
  });

  it('converts to internal ToolDef', () => {
    const tool = defineTool({
      name: 'greet',
      description: 'Say hello',
      input: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      execute: async (input) => `Hello ${input.name}`,
    });

    const toolDef = tool.toToolDef({} as any);
    assert.equal(toolDef.name, 'greet');
    assert.equal(typeof toolDef.handler, 'function');
  });

  it('respects role scoping', () => {
    const tool = defineTool({
      name: 'deploy',
      description: 'Deploy to production',
      input: { type: 'object', properties: {}, required: [] },
      roles: ['worker'],
      execute: async () => 'deployed',
    });

    assert.deepEqual(tool.definition.roles, ['worker']);
  });
});

describe('ToolRegistry', () => {
  it('registers tools and retrieves by role', () => {
    const registry = new ToolRegistry();
    const tool = defineTool({
      name: 'custom',
      description: 'Custom tool',
      input: { type: 'object', properties: {}, required: [] },
      roles: ['worker', 'planner'],
      execute: async () => 'ok',
    });

    registry.register(tool);
    assert.equal(registry.toolsForRole('worker').length, 1);
    assert.equal(registry.toolsForRole('planner').length, 1);
    assert.equal(registry.toolsForRole('reviewer').length, 0);
  });

  it('defaults to all roles when none specified', () => {
    const registry = new ToolRegistry();
    const tool = defineTool({
      name: 'universal',
      description: 'Universal tool',
      input: { type: 'object', properties: {}, required: [] },
      execute: async () => 'ok',
    });

    registry.register(tool);
    assert.equal(registry.toolsForRole('worker').length, 1);
    assert.equal(registry.toolsForRole('communicator').length, 1);
    assert.equal(registry.toolsForRole('reviewer').length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/api/define-tool.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Add tool types to types.ts**

```ts
// packages/runtime/src/api/types.ts (append)
import type { JsonSchema, ToolDef } from '../llm/types.js';
import type { ToolContext } from '../context.js';

export interface ToolDefinition<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  input: JsonSchema;
  roles?: RoleName[];
  needsApproval?: boolean | ((input: TInput) => boolean);
  execute: (input: TInput, ctx: ToolContext) => Promise<string> | string;
}

export interface ArtificerTool<TInput = Record<string, unknown>> {
  readonly name: string;
  readonly definition: ToolDefinition<TInput>;
  toToolDef(ctx: ToolContext): ToolDef;
}
```

- [ ] **Step 4: Implement `defineTool` and `ToolRegistry`**

```ts
// packages/runtime/src/api/define-tool.ts
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import type { ArtificerTool, ToolDefinition } from './types.js';

export function defineTool<TInput = Record<string, unknown>>(
  definition: ToolDefinition<TInput>,
): ArtificerTool<TInput> {
  return {
    name: definition.name,
    definition,
    toToolDef(ctx: ToolContext): ToolDef {
      return {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.input,
        handler: (input) =>
          Promise.resolve(definition.execute(input as TInput, ctx)).then(String),
      };
    },
  };
}
```

```ts
// packages/runtime/src/api/tool-registry.ts
import type { RoleName } from '../storage/types.js';
import type { ArtificerTool } from './types.js';

const ALL_ROLES: RoleName[] = [
  'communicator', 'orchestrator', 'planner', 'reviewer', 'worker', 'librarian',
];

export class ToolRegistry {
  private readonly custom = new Map<RoleName, ArtificerTool[]>();

  register(tool: ArtificerTool): void {
    const roles = tool.definition.roles ?? ALL_ROLES;
    for (const role of roles) {
      const list = this.custom.get(role) ?? [];
      list.push(tool);
      this.custom.set(role, list);
    }
  }

  toolsForRole(role: RoleName): ArtificerTool[] {
    return this.custom.get(role) ?? [];
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/api/define-tool.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 6: Integrate into existing `toolsForRole`**

Modify `packages/runtime/src/tools/registry.ts` — add a `customRegistry` parameter and append custom tools after the built-in switch:

Change the function signature from:
```ts
export function toolsForRole(role: RoleName, ctx: ToolContext): ToolDef[] {
```
To:
```ts
export function toolsForRole(
  role: RoleName,
  ctx: ToolContext,
  customRegistry?: ToolRegistry,
): ToolDef[] {
```

At the end of the function, before the final return, add:
```ts
  // Append custom tools from the registry
  if (customRegistry) {
    const custom = customRegistry.toolsForRole(role).map((t) => t.toToolDef(ctx));
    result.push(...custom);
  }
  return result;
```

(This requires refactoring the switch to assign to a `result` variable instead of returning directly from each case.)

- [ ] **Step 7: Export from index.ts**

```ts
export { defineTool } from './api/define-tool.js';
export { ToolRegistry } from './api/tool-registry.js';
export type { ToolDefinition, ArtificerTool } from './api/types.js';
```

- [ ] **Step 8: Run full test suite**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add packages/runtime/src/api/define-tool.ts packages/runtime/src/api/define-tool.test.ts packages/runtime/src/api/tool-registry.ts packages/runtime/src/api/types.ts packages/runtime/src/tools/registry.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add defineTool public API with role scoping"
```

---

### Task 4: `defineChannel` + `defineSkill` — Extension APIs

Channel adapters and on-demand knowledge. These follow the same `define*` pattern established in Tasks 2–3.

**Files:**
- Create: `packages/runtime/src/api/define-channel.ts`
- Create: `packages/runtime/src/api/define-skill.ts`
- Modify: `packages/runtime/src/api/types.ts` (add channel/skill types)
- Modify: `packages/runtime/src/index.ts` (add exports)
- Test: `packages/runtime/src/api/define-channel.test.ts`
- Test: `packages/runtime/src/api/define-skill.test.ts`

**Interfaces:**
- Consumes: `EngineApi` from `context.ts`
- Produces: `defineChannel(definition: ChannelDefinition): ArtificerChannel` — normalizes platform input to engine messages, formats engine output for the platform, and optionally verifies webhook signatures. `defineSkill(definition: SkillDefinition): ArtificerSkill` — a named knowledge block that advertises its description in the system prompt and loads its full content on demand.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/runtime/src/api/define-channel.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineChannel } from './define-channel.js';

describe('defineChannel', () => {
  it('creates a channel with receive and format', async () => {
    const channel = defineChannel({
      name: 'slack',
      description: 'Slack integration',
      receive: async (payload) => ({
        content: payload.text as string,
        metadata: { channel: 'slack' },
      }),
      format: async (output) => ({ text: output.content }),
    });

    assert.equal(channel.name, 'slack');
    const msg = await channel.receive({ text: 'hello' });
    assert.equal(msg.content, 'hello');
    const fmt = await channel.format({ content: 'world' });
    assert.equal(fmt.text, 'world');
  });

  it('supports webhook verification', async () => {
    const channel = defineChannel({
      name: 'secure',
      description: 'Secure channel',
      verify: async (headers) => headers['x-token'] === 'valid',
      receive: async (p) => ({ content: String(p.text) }),
      format: async (o) => ({ text: o.content }),
    });

    const ok = await channel.definition.verify!({ 'x-token': 'valid' }, '');
    const bad = await channel.definition.verify!({ 'x-token': 'bad' }, '');
    assert.equal(ok, true);
    assert.equal(bad, false);
  });
});
```

```ts
// packages/runtime/src/api/define-skill.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineSkill } from './define-skill.js';

describe('defineSkill', () => {
  it('creates a skill with name, description, and content', () => {
    const skill = defineSkill({
      name: 'code-review',
      description: 'Code review checklist for the payments team',
      content: '## Checklist\n1. Check PCI compliance\n2. Use Money type',
    });

    assert.equal(skill.name, 'code-review');
    assert.equal(skill.description, 'Code review checklist for the payments team');
    assert.ok(skill.content.includes('PCI compliance'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && npx tsx --test src/api/define-channel.test.ts src/api/define-skill.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Add types**

```ts
// packages/runtime/src/api/types.ts (append)

export interface ChannelMessage {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutput {
  content: string;
  workstreamId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelDefinition {
  name: string;
  description: string;
  verify?: (headers: Record<string, string>, body: string) => Promise<boolean> | boolean;
  receive: (payload: Record<string, unknown>) => Promise<ChannelMessage>;
  format: (output: ChannelOutput) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface ArtificerChannel {
  readonly name: string;
  readonly definition: ChannelDefinition;
  receive(payload: Record<string, unknown>): Promise<ChannelMessage>;
  format(output: ChannelOutput): Promise<Record<string, unknown>>;
}

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
}

export interface ArtificerSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}
```

- [ ] **Step 4: Implement `defineChannel` and `defineSkill`**

```ts
// packages/runtime/src/api/define-channel.ts
import type { ArtificerChannel, ChannelDefinition } from './types.js';

export function defineChannel(definition: ChannelDefinition): ArtificerChannel {
  return {
    name: definition.name,
    definition,
    receive: (payload) => Promise.resolve(definition.receive(payload)),
    format: (output) => Promise.resolve(definition.format(output)),
  };
}
```

```ts
// packages/runtime/src/api/define-skill.ts
import type { ArtificerSkill, SkillDefinition } from './types.js';

export function defineSkill(definition: SkillDefinition): ArtificerSkill {
  return {
    name: definition.name,
    description: definition.description,
    content: definition.content,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/api/define-channel.test.ts src/api/define-skill.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 6: Export from index.ts**

```ts
export { defineChannel } from './api/define-channel.js';
export { defineSkill } from './api/define-skill.js';
export type {
  ChannelDefinition, ArtificerChannel, ChannelMessage, ChannelOutput,
  SkillDefinition, ArtificerSkill,
} from './api/types.js';
```

- [ ] **Step 7: Run full test suite and commit**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

```bash
git add packages/runtime/src/api/define-channel.ts packages/runtime/src/api/define-channel.test.ts packages/runtime/src/api/define-skill.ts packages/runtime/src/api/define-skill.test.ts packages/runtime/src/api/types.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add defineChannel and defineSkill public APIs"
```

---

### Task 5: Agent Directory Discovery

Scan the conventional `agent/` directory and `identity/` directory to assemble all user-defined extensions and agent-written identity files into a loadable manifest.

**Files:**
- Create: `packages/runtime/src/discover/discover.ts`
- Create: `packages/runtime/src/discover/loader.ts`
- Modify: `packages/runtime/src/index.ts` (add exports)
- Test: `packages/runtime/src/discover/discover.test.ts`
- Test: `packages/runtime/src/discover/loader.test.ts`

**Interfaces:**
- Consumes: `ArtificerConfig` from Task 2, `ArtificerTool` from Task 3, `ArtificerSkill` from Task 4, `IdentityStore` from Task 1
- Produces: `scanAgentDirectory(rootDir: string): AgentManifest` — synchronously scans the filesystem and returns a manifest of discovered module references (paths + names). `loadManifest(manifest: AgentManifest): Promise<LoadedAgent>` — imports TypeScript modules (via dynamic import) and reads markdown files to produce a fully resolved agent configuration with tools, channels, skills, instructions, and config.

- [ ] **Step 1: Write the failing test for `scanAgentDirectory`**

```ts
// packages/runtime/src/discover/discover.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanAgentDirectory } from './discover.js';

describe('scanAgentDirectory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-discover-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers tools, channels, skills, instructions, and config', () => {
    fs.mkdirSync(path.join(tmpDir, 'agent', 'tools'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'agent', 'channels'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'agent', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'agent', 'tools', 'jira.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'agent', 'channels', 'slack.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'agent', 'skills', 'review.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'agent', 'instructions.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'artificer.config.ts'), '');

    const manifest = scanAgentDirectory(tmpDir);
    assert.equal(manifest.tools.length, 1);
    assert.equal(manifest.tools[0].name, 'jira');
    assert.equal(manifest.channels.length, 1);
    assert.equal(manifest.channels[0].name, 'slack');
    assert.equal(manifest.skills.length, 1);
    assert.equal(manifest.skills[0].name, 'review');
    assert.ok(manifest.instructions);
    assert.ok(manifest.config);
  });

  it('returns empty manifest for bare directory', () => {
    const manifest = scanAgentDirectory(tmpDir);
    assert.equal(manifest.tools.length, 0);
    assert.equal(manifest.channels.length, 0);
    assert.equal(manifest.skills.length, 0);
    assert.equal(manifest.instructions, undefined);
    assert.equal(manifest.config, undefined);
  });

  it('discovers identity/memories', () => {
    fs.mkdirSync(path.join(tmpDir, 'identity', 'memories'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'identity', 'memories', 'pref_abc.md'),
      '---\nid: "pref_abc"\n---\n\nContent',
    );

    const manifest = scanAgentDirectory(tmpDir);
    assert.equal(manifest.memories.length, 1);
    assert.equal(manifest.memories[0].name, 'pref_abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/discover/discover.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `scanAgentDirectory`**

```ts
// packages/runtime/src/discover/discover.ts
import fs from 'node:fs';
import path from 'node:path';

export interface ModuleRef {
  name: string;
  path: string;
}

export interface AgentManifest {
  config?: ModuleRef;
  instructions?: ModuleRef;
  tools: ModuleRef[];
  channels: ModuleRef[];
  skills: ModuleRef[];
  memories: ModuleRef[];
}

function listByExt(dir: string, ext: string): ModuleRef[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(ext) && !f.startsWith('.'))
    .map((f) => ({ name: path.basename(f, ext), path: path.join(dir, f) }));
}

export function scanAgentDirectory(rootDir: string): AgentManifest {
  const manifest: AgentManifest = {
    tools: [],
    channels: [],
    skills: [],
    memories: [],
  };

  const configPath = path.join(rootDir, 'artificer.config.ts');
  if (fs.existsSync(configPath)) {
    manifest.config = { name: 'config', path: configPath };
  }

  const instructionsPath = path.join(rootDir, 'agent', 'instructions.md');
  if (fs.existsSync(instructionsPath)) {
    manifest.instructions = { name: 'instructions', path: instructionsPath };
  }

  manifest.tools = listByExt(path.join(rootDir, 'agent', 'tools'), '.ts');
  manifest.channels = listByExt(path.join(rootDir, 'agent', 'channels'), '.ts');
  manifest.skills = [
    ...listByExt(path.join(rootDir, 'agent', 'skills'), '.md'),
    ...listByExt(path.join(rootDir, 'agent', 'skills'), '.ts'),
  ];
  manifest.memories = listByExt(
    path.join(rootDir, 'identity', 'memories'),
    '.md',
  );

  return manifest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && npx tsx --test src/discover/discover.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Write failing test for `loadSkillsFromDisk`**

```ts
// packages/runtime/src/discover/loader.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSkillsFromDisk, loadInstructionsFromDisk } from './loader.js';

describe('loadSkillsFromDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-loader-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads markdown files as skills', () => {
    const skillPath = path.join(tmpDir, 'review.md');
    fs.writeFileSync(skillPath, '# Code Review\n\nCheck for bugs.');

    const skills = loadSkillsFromDisk([
      { name: 'review', path: skillPath },
    ]);

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'review');
    assert.equal(skills[0].description, 'Code Review');
    assert.ok(skills[0].content.includes('Check for bugs'));
  });
});

describe('loadInstructionsFromDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-loader-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a markdown file as instructions', () => {
    const mdPath = path.join(tmpDir, 'instructions.md');
    fs.writeFileSync(mdPath, '## Team Rules\nBe concise.');

    const instructions = loadInstructionsFromDisk(mdPath);
    assert.ok(instructions);
    assert.ok(instructions.content.includes('Be concise'));
  });

  it('returns null for missing file', () => {
    const instructions = loadInstructionsFromDisk(
      path.join(tmpDir, 'nope.md'),
    );
    assert.equal(instructions, null);
  });
});
```

- [ ] **Step 6: Implement `loadSkillsFromDisk` and `loadInstructionsFromDisk`**

```ts
// packages/runtime/src/discover/loader.ts
import fs from 'node:fs';
import type { ArtificerSkill } from '../api/types.js';
import type { ModuleRef } from './discover.js';

export function loadSkillsFromDisk(refs: ModuleRef[]): ArtificerSkill[] {
  return refs
    .filter((ref) => ref.path.endsWith('.md'))
    .map((ref) => {
      const content = fs.readFileSync(ref.path, 'utf-8');
      const firstLine = content.split('\n')[0] ?? '';
      const description = firstLine.replace(/^#\s*/, '').trim() || ref.name;
      return { name: ref.name, description, content };
    });
}

export function loadInstructionsFromDisk(
  filePath: string,
): { content: string } | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content };
  } catch {
    return null;
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/discover/loader.test.ts`
Expected: PASS

- [ ] **Step 8: Export from index.ts**

```ts
export { scanAgentDirectory, type AgentManifest, type ModuleRef } from './discover/discover.js';
export { loadSkillsFromDisk, loadInstructionsFromDisk } from './discover/loader.js';
```

- [ ] **Step 9: Run full test suite and commit**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

```bash
git add packages/runtime/src/discover/discover.ts packages/runtime/src/discover/discover.test.ts packages/runtime/src/discover/loader.ts packages/runtime/src/discover/loader.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add agent directory discovery with identity/memories support"
```

---

### Task 6: `createRuntime` — Unified Bootstrap with Agent-as-Repo

The entry point that ties everything together. Accepts a root directory (the agent repo), discovers the configuration and extensions, sets up the identity and execution stores, and returns a startable runtime.

**Files:**
- Create: `packages/runtime/src/api/create-runtime.ts`
- Modify: `packages/runtime/src/api/types.ts` (add RuntimeOptions, ArtificerRuntime)
- Modify: `packages/runtime/src/index.ts` (add exports)
- Test: `packages/runtime/src/api/create-runtime.test.ts`

**Interfaces:**
- Consumes: `ArtificerConfig` from Task 2, `ToolRegistry` from Task 3, `IdentityStore` from Task 1, `scanAgentDirectory` from Task 5, `loadSkillsFromDisk` and `loadInstructionsFromDisk` from Task 5, `Engine` from `engine/engine.ts`, `Store` from `storage/store.ts`, `createApp` from `server/app.ts`, `mergeWithDefinition` from `config.ts`
- Produces: `createRuntime(options: RuntimeOptions): Promise<ArtificerRuntime>` — discovers the agent repo, loads config and extensions, sets up stores, creates the engine and HTTP app, returns an object with `.start()`, `.engine`, `.config`, `.identity`, `.tools`, `.skills`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/api/create-runtime.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRuntime } from './create-runtime.js';

describe('createRuntime', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-runtime-'));
    // Create minimal agent repo structure
    fs.mkdirSync(path.join(tmpDir, 'identity', 'memories'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.artificer'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a runtime from a directory', async () => {
    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
      },
    });

    assert.ok(runtime.engine);
    assert.ok(runtime.app);
    assert.ok(runtime.config);
    assert.ok(runtime.identity);
    assert.ok(runtime.tools);
    assert.equal(typeof runtime.start, 'function');
  });

  it('uses .artificer/ for execution state', async () => {
    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
      },
    });

    assert.ok(runtime.config.dataDir.includes('.artificer'));
  });

  it('uses identity/ for identity store', async () => {
    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
      },
    });

    assert.equal(runtime.config.identityDir, tmpDir);
  });

  it('discovers skills from agent/skills/', async () => {
    fs.mkdirSync(path.join(tmpDir, 'agent', 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'agent', 'skills', 'review.md'),
      '# Review\nCheck things.',
    );

    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
      },
    });

    assert.equal(runtime.skills.length, 1);
    assert.equal(runtime.skills[0].name, 'review');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/api/create-runtime.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Add types**

```ts
// packages/runtime/src/api/types.ts (append)
import type { Engine } from '../engine/engine.js';
import type { ToolRegistry } from './tool-registry.js';
import type { IdentityStore } from '../storage/identity-store.js';
import type { RuntimeConfig } from '../config.js';
import type { Hono } from 'hono';

export interface RuntimeOptions {
  rootDir: string;
  config?: Partial<RuntimeConfig>;
}

export interface ArtificerRuntime {
  readonly engine: Engine;
  readonly app: Hono;
  readonly config: RuntimeConfig;
  readonly identity: IdentityStore;
  readonly tools: ToolRegistry;
  readonly skills: ArtificerSkill[];
  readonly instructions: string | null;
  start(port?: number): Promise<void>;
}
```

- [ ] **Step 4: Implement `createRuntime`**

```ts
// packages/runtime/src/api/create-runtime.ts
import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadConfig, type RuntimeConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import { createApp } from '../server/app.js';
import { Store } from '../storage/store.js';
import { IdentityStore } from '../storage/identity-store.js';
import { ToolRegistry } from './tool-registry.js';
import { scanAgentDirectory } from '../discover/discover.js';
import { loadSkillsFromDisk, loadInstructionsFromDisk } from '../discover/loader.js';
import type { ArtificerRuntime, ArtificerSkill, RuntimeOptions } from './types.js';

export async function createRuntime(
  options: RuntimeOptions,
): Promise<ArtificerRuntime> {
  const { rootDir } = options;

  const envConfig = loadConfig();
  const dataDir = options.config?.dataDir ?? path.join(rootDir, '.artificer');

  const config: RuntimeConfig = {
    ...envConfig,
    ...options.config,
    dataDir,
    identityDir: rootDir,
  } as RuntimeConfig;

  // Discover agent directory structure
  const manifest = scanAgentDirectory(rootDir);

  // Load static assets (skills, instructions)
  const skills: ArtificerSkill[] = loadSkillsFromDisk(manifest.skills);
  const instructions = manifest.instructions
    ? loadInstructionsFromDisk(manifest.instructions.path)
    : null;

  // Set up stores
  const store = new Store(dataDir);
  await store.init();
  const identity = new IdentityStore(rootDir);
  await identity.init();

  // Set up registries
  const tools = new ToolRegistry();
  // Note: loading .ts tool modules requires dynamic import, which depends on
  // the CLI build step or tsx. For now, tools are registered programmatically
  // via the escape hatch or loaded by the CLI layer (future task).

  const engine = new Engine(config, store);
  const app = createApp(engine);

  return {
    engine,
    app,
    config,
    identity,
    tools,
    skills,
    instructions: instructions?.content ?? null,
    async start(port?: number) {
      const p = port ?? config.port;
      serve({ fetch: app.fetch, port: p }, (info) => {
        console.log(
          `[artificer] ${config.agentName} listening on http://localhost:${info.port}`,
        );
        console.log(`[artificer] identity: ${rootDir}`);
        console.log(`[artificer] execution: ${dataDir}`);
      });
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/api/create-runtime.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 6: Export from index.ts**

```ts
export { createRuntime } from './api/create-runtime.js';
export type { RuntimeOptions, ArtificerRuntime } from './api/types.js';
```

- [ ] **Step 7: Run full test suite and commit**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

```bash
git add packages/runtime/src/api/create-runtime.ts packages/runtime/src/api/create-runtime.test.ts packages/runtime/src/api/types.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add createRuntime with agent-as-repo model"
```

---

## What This Plan Produces

After these 6 tasks, the runtime has:

1. **Identity/execution split** — memories as markdown files in `identity/`, execution state in `.artificer/`
2. **`defineConfig`** — typed agent configuration in `artificer.config.ts`
3. **`defineTool`** — custom tools with role scoping, writable by users and the agent
4. **`defineChannel` + `defineSkill`** — channel adapters and on-demand knowledge
5. **Agent discovery** — filesystem convention scanning `agent/` and `identity/`
6. **`createRuntime`** — unified bootstrap that wires identity repo → running agent

## What This Plan Does NOT Cover (Future Work)

1. **CLI package (`@artificer/cli`)** — `artificer init`, `artificer dev`, `artificer build`. Needs its own package with TypeScript module loading (tsx/esbuild), hot-reload watcher, and TUI. Depends on Tasks 5–6.

2. **Wiring identity into the engine** — threading `IdentityStore`, `ToolRegistry`, instructions, and skills through `Engine` → `executeCall` → `toolsForRole` and system prompts. Small follow-up tasks that connect the plumbing.

3. **Self-modification tools** — explicit `modify_identity` / `add_skill` / `add_tool` tools for the agent, or reusing existing `write_file` scoped to the identity directory. Needs design around hot-reload vs restart semantics.

4. **Auto-commit daemon** — watching identity file changes, committing with descriptive messages, optional push. Depends on the `identity.autoCommit` config from Task 2.

5. **Channel route mounting** — mounting channel-specific HTTP routes on the Hono app with webhook verification and response formatting.

6. **Concrete channel adapters** — built-in Slack, Discord, GitHub, etc. implementations.

7. **Connection abstraction** — `defineConnection` for MCP and OpenAPI integrations with managed auth. Credentials live in `.env` and are referenced by name in the connection definition (e.g. `auth: { type: 'bearer', envVar: 'LINEAR_API_KEY' }`). The runtime injects credentials at the HTTP layer so raw tokens never appear in tool results or LLM context. Future work includes OAuth consent flows, automatic token refresh, and credential brokering (Eve's pattern where secrets are injected at a firewall, never in the sandbox).

8. **Human-in-the-loop approval gates** — runtime enforcement of `needsApproval` on tools.

9. **Memory migration** — migrating existing JSON-blob memories to the new markdown identity format.

10. **Template project** — the starter repo that `artificer init` scaffolds.
