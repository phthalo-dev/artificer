# Agent Memory & Teaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person teach the agent by sending links or content over the normal message channel; the agent reads/distills the material into durable, recallable memory and can apply it later.

**Architecture:** The communicator recognizes teaching intent and spawns a dedicated async `librarian` call (medium-tier model) that fetches the URL (new `fetch_url` tool), distills durable facts, and saves them via an upgraded `add_memory`. Memories are stored one-JSON-per-file plus a lightweight `index.json`; recall is keyword/lexical, pull-only via an upgraded `query_memories`, with a cheap "signpost" line in context so the agent knows it has memory to query. A Memories page is added to `runtime-ui`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node 20+ global `fetch`, Hono server, `tsx` runner, `node:test` for unit tests, React + Mantine + react-query for the UI.

**Reference spec:** `docs/superpowers/specs/2026-05-29-agent-memory-teaching-design.md`

---

## File Structure

**Runtime (`packages/runtime`)**
- Create: `src/storage/memory-search.ts` — pure ranking + index-entry types (testable).
- Create: `src/storage/memory-search.test.ts` — unit tests for ranking.
- Create: `src/tools/fetch-util.ts` — pure HTML→text/title/truncate helpers (testable).
- Create: `src/tools/fetch-util.test.ts` — unit tests for HTML→text.
- Create: `src/tools/fetch.ts` — the `fetch_url` tool.
- Modify: `src/storage/types.ts` — enrich `Memory`, add `librarian` to `RoleName`.
- Modify: `src/storage/layout.ts` — add `memoryIndexFile()`.
- Modify: `src/storage/store.ts` — index-backed `addMemory`/`listMemories`/`queryMemories`/`memorySignpost`.
- Modify: `src/engine/models.ts` — `DEFAULT_ROLE_TIER.librarian`.
- Modify: `src/engine/roles.ts` — `librarian` role + communicator prompt update.
- Modify: `src/engine/call.ts` — dynamic memory signpost in `buildContext`.
- Modify: `src/tools/orchestrator-tool.ts` — upgrade `query_memories` + `add_memory`.
- Modify: `src/tools/communication.ts` — add `learn` tool.
- Modify: `src/tools/registry.ts` — wire fetch tools + `librarian` role.
- Modify: `src/server/app.ts` — `GET /memories`.
- Modify: `package.json` — `test` script + `tsx` (already present).

**UI (`apps/runtime-ui`)**
- Modify: `src/api/types.ts` — add `Memory`, add `librarian` to `RoleName`.
- Modify: `src/api/hooks.ts` — `useMemories`.
- Modify: `src/App.tsx` — Memories nav entry + route.
- Create: `src/pages/MemoriesPage.tsx` — the Memories page.

---

## Task 1: Test harness (node:test + tsx)

**Files:**
- Modify: `packages/runtime/package.json`
- Test: `packages/runtime/src/sanity.test.ts` (temporary, removed at end of task)

- [ ] **Step 1: Add a test script.** Edit `packages/runtime/package.json` `scripts` to add a `test` entry (keep existing scripts):

```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "type-check": "tsc --noEmit",
    "test": "node --import tsx --test \"src/**/*.test.ts\"",
    "clean": "rm -rf dist",
    "docker:build": "docker build -t artificer-runtime:dev .",
    "docker:run": "docker compose up"
  },
```

- [ ] **Step 2: Write a sanity test.** Create `packages/runtime/src/sanity.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('test harness runs', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run it.**

Run: `pnpm --filter @artificer/runtime test`
Expected: PASS — output shows `# pass 1` and exit code 0.

- [ ] **Step 4: Remove the sanity test.** Delete `packages/runtime/src/sanity.test.ts`.

- [ ] **Step 5: Commit.**

```bash
git add packages/runtime/package.json
git commit -m "chore(runtime): add node:test test script"
```

---

## Task 2: Memory ranking (pure function)

**Files:**
- Create: `packages/runtime/src/storage/memory-search.ts`
- Test: `packages/runtime/src/storage/memory-search.test.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/runtime/src/storage/memory-search.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankMemories, tokenize, type MemoryIndexEntry } from './memory-search.js';

const entries: MemoryIndexEntry[] = [
  { id: 'a', title: 'Deploy process', summary: 'How we ship to prod', tags: ['deploy', 'ops'], createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'b', title: 'Python style', summary: 'Prefer type hints', tags: ['python'], createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'c', title: 'Coffee order', summary: 'Oat latte', tags: ['prefs'], createdAt: '2026-01-03T00:00:00.000Z' },
];

test('tokenize lowercases, splits, and drops stopwords/short tokens', () => {
  assert.deepEqual(tokenize('The Deploy-Process to PROD'), ['deploy', 'process', 'prod']);
});

test('ranks tag matches above text-only matches', () => {
  const ranked = rankMemories('deploy', entries);
  assert.equal(ranked[0].entry.id, 'a');
  assert.ok(ranked[0].score >= 3);
});

test('returns only matching entries for a non-empty query', () => {
  const ranked = rankMemories('python', entries);
  assert.deepEqual(ranked.map((r) => r.entry.id), ['b']);
});

test('empty query returns all entries in recency order', () => {
  const ranked = rankMemories('', entries);
  assert.deepEqual(ranked.map((r) => r.entry.id), ['c', 'b', 'a']);
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @artificer/runtime test`
Expected: FAIL — cannot find module `./memory-search.js`.

- [ ] **Step 3: Implement.** Create `packages/runtime/src/storage/memory-search.ts`:

```ts
/** Compact, searchable record for one memory; the full content lives in its own file. */
export interface MemoryIndexEntry {
  id: string;
  title?: string;
  summary?: string;
  tags: string[];
  source?: string;
  createdAt: string;
}

export interface RankedEntry {
  entry: MemoryIndexEntry;
  score: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'is', 'it',
  'this', 'that', 'with', 'as', 'at', 'by', 'be', 'we', 'our', 'how',
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and 1-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function entryText(e: MemoryIndexEntry): string {
  return [e.title, e.summary, e.tags.join(' ')].filter(Boolean).join(' ');
}

/**
 * Keyword/lexical ranking. A non-empty query returns only entries that match at
 * least one query token (tag matches are boosted); an empty query returns all
 * entries in recency order. This is the single place recall scoring lives, so a
 * semantic ranker could replace it later without touching callers.
 */
export function rankMemories(
  query: string,
  entries: MemoryIndexEntry[],
): RankedEntry[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) {
    return [...entries]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => ({ entry, score: 0 }));
  }
  const scored = entries.map((entry) => {
    const counts = new Map<string, number>();
    for (const tok of tokenize(entryText(entry))) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
    const tagTokens = new Set(entry.tags.map((t) => t.toLowerCase()));
    let score = 0;
    for (const q of qTokens) {
      score += counts.get(q) ?? 0;
      if (tagTokens.has(q)) score += 3;
    }
    return { entry, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt),
    );
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @artificer/runtime test`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/runtime/src/storage/memory-search.ts packages/runtime/src/storage/memory-search.test.ts
git commit -m "feat(runtime): add keyword memory ranking"
```

---

## Task 3: Enrich the Memory type + RoleName

**Files:**
- Modify: `packages/runtime/src/storage/types.ts:120-125` (the `Memory` interface) and `:1-6` (`RoleName`)

- [ ] **Step 1: Add `librarian` to `RoleName`.** Edit the union at the top of `types.ts`:

```ts
export type RoleName =
  | 'communicator'
  | 'orchestrator'
  | 'planner'
  | 'reviewer'
  | 'worker'
  | 'librarian';
```

- [ ] **Step 2: Enrich `Memory`.** Replace the existing `Memory` interface:

```ts
export interface Memory {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  /** Short human label. */
  title?: string;
  /** One-line gist used for ranking and listings. */
  summary?: string;
  /** Where this came from: a URL, or "conversation". */
  source?: string;
  kind?: 'note' | 'document';
  updatedAt?: string;
}
```

- [ ] **Step 3: Type-check.**

Run: `pnpm --filter @artificer/runtime type-check`
Expected: FAIL — exhaustive records keyed by `RoleName` (in `engine/models.ts` `DEFAULT_ROLE_TIER` and `engine/roles.ts` `ROLES`) now error: `Property 'librarian' is missing`. This is expected; Tasks 6 fixes them. (If you prefer a green checkpoint, do Step 4 of Task 6 before committing; otherwise commit now and let the next tasks resolve it.)

- [ ] **Step 4: Commit.**

```bash
git add packages/runtime/src/storage/types.ts
git commit -m "feat(runtime): enrich Memory type and add librarian role name"
```

---

## Task 4: Index-backed store (addMemory, listMemories, queryMemories, signpost)

**Files:**
- Modify: `packages/runtime/src/storage/layout.ts:67-69`
- Modify: `packages/runtime/src/storage/store.ts` (imports + `// --- Memories ---` section, lines ~296-322)

- [ ] **Step 1: Add the index file path.** In `layout.ts`, directly under the existing `memoryFile(...)` method, add:

```ts
  memoryIndexFile(): string {
    return path.join(this.memoriesDir, 'index.json');
  }
```

- [ ] **Step 2: Import the search module in `store.ts`.** Add to the top-of-file imports (next to the other `./...` imports):

```ts
import {
  rankMemories,
  type MemoryIndexEntry,
} from './memory-search.js';
```

- [ ] **Step 3: Replace the entire `// --- Memories ---` section** in `store.ts` (the current `addMemory`, `listMemories`, `searchMemories` methods) with:

```ts
  // --- Memories ---

  async addMemory(input: {
    content: string;
    tags?: string[];
    title?: string;
    summary?: string;
    source?: string;
    kind?: Memory['kind'];
  }): Promise<Memory> {
    const createdAt = now();
    const memory: Memory = {
      id: newId('mem'),
      content: input.content,
      tags: input.tags ?? [],
      title: input.title,
      summary: input.summary,
      source: input.source,
      kind: input.kind,
      createdAt,
      updatedAt: createdAt,
    };
    await writeJson(this.layout.memoryFile(memory.id, memory.createdAt), memory);
    const index = await this.readMemoryIndex();
    index.push(this.toIndexEntry(memory));
    await writeJson(this.layout.memoryIndexFile(), index);
    return memory;
  }

  /** All memories, newest-first, reading the per-memory files (excludes index.json). */
  async listMemories(): Promise<Memory[]> {
    const dir = this.layout.memoriesDir;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const files = names
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .sort();
    const out: Memory[] = [];
    for (const f of files) {
      const m = await readJson<Memory>(path.join(dir, f));
      if (m) out.push(m);
    }
    return out;
  }

  /**
   * Pull-only recall: rank the lightweight index by keyword overlap, optionally
   * filter by tags, and load only the top matches' full content within a budget.
   */
  async queryMemories(
    query: string,
    opts: { tags?: string[]; limit?: number } = {},
  ): Promise<Memory[]> {
    const limit = opts.limit ?? 5;
    const charBudget = 4000;
    let entries = await this.readMemoryIndex();
    if (opts.tags && opts.tags.length > 0) {
      const want = new Set(opts.tags.map((t) => t.toLowerCase()));
      entries = entries.filter((e) =>
        e.tags.some((t) => want.has(t.toLowerCase())),
      );
    }
    const ranked = rankMemories(query, entries).slice(0, limit);
    const out: Memory[] = [];
    let used = 0;
    for (const r of ranked) {
      const m = await readJson<Memory>(
        this.layout.memoryFile(r.entry.id, r.entry.createdAt),
      );
      if (!m) continue;
      out.push(m);
      used += m.content.length;
      if (used >= charBudget) break;
    }
    return out;
  }

  /** Compact "you know things" hint for context (count + top tags); no content. */
  async memorySignpost(): Promise<string | null> {
    const entries = await this.readMemoryIndex();
    if (entries.length === 0) return null;
    const counts = new Map<string, number>();
    for (const e of entries) {
      for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const topTags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);
    const topics = topTags.length ? ` (topics: ${topTags.join(', ')})` : '';
    return `You have ${entries.length} memories${topics}. Use query_memories to recall anything relevant before answering.`;
  }

  private toIndexEntry(m: Memory): MemoryIndexEntry {
    return {
      id: m.id,
      title: m.title,
      summary: m.summary,
      tags: m.tags,
      source: m.source,
      createdAt: m.createdAt,
    };
  }

  /** Read index.json; rebuild it from per-memory files if missing/unreadable. */
  private async readMemoryIndex(): Promise<MemoryIndexEntry[]> {
    const existing = await readJson<MemoryIndexEntry[]>(
      this.layout.memoryIndexFile(),
    );
    if (existing) return existing;
    const rebuilt = (await this.listMemories()).map((m) => this.toIndexEntry(m));
    await writeJson(this.layout.memoryIndexFile(), rebuilt);
    return rebuilt;
  }
```

- [ ] **Step 4: Type-check.**

Run: `pnpm --filter @artificer/runtime type-check`
Expected: FAIL — `orchestrator-tool.ts` still calls the old `store.addMemory(string, tags)` / `store.searchMemories(...)`. Fixed in Task 7. (Records-keyed-by-RoleName errors from Task 3 also still present until Task 6.) Proceed.

- [ ] **Step 5: Commit.**

```bash
git add packages/runtime/src/storage/layout.ts packages/runtime/src/storage/store.ts
git commit -m "feat(runtime): index-backed memory store with ranked pull-only recall"
```

---

## Task 5: `fetch_url` tool

**Files:**
- Create: `packages/runtime/src/tools/fetch-util.ts`
- Test: `packages/runtime/src/tools/fetch-util.test.ts`
- Create: `packages/runtime/src/tools/fetch.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/runtime/src/tools/fetch-util.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractTitle, htmlToText, truncateText } from './fetch-util.js';

test('extractTitle pulls and decodes the <title>', () => {
  assert.equal(extractTitle('<html><head><title>Hello &amp; Bye</title></head>'), 'Hello & Bye');
  assert.equal(extractTitle('<html><body>no title</body></html>'), undefined);
});

test('htmlToText strips scripts/styles/tags and decodes entities', () => {
  const html = '<html><head><style>.a{}</style></head><body><h1>Title</h1><script>var x=1;</script><p>Hello&nbsp;world &amp; more</p></body></html>';
  const text = htmlToText(html);
  assert.ok(!text.includes('var x'));
  assert.ok(!text.includes('.a{}'));
  assert.ok(text.includes('Title'));
  assert.ok(text.includes('Hello world & more'));
});

test('truncateText caps length and flags truncation', () => {
  const { text, truncated } = truncateText('abcdef', 3);
  assert.equal(truncated, true);
  assert.ok(text.startsWith('abc'));
  assert.equal(truncateText('ab', 3).truncated, false);
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @artificer/runtime test`
Expected: FAIL — cannot find module `./fetch-util.js`.

- [ ] **Step 3: Implement the helpers.** Create `packages/runtime/src/tools/fetch-util.ts`:

```ts
const MAX_TEXT = 50_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].trim()) : undefined;
}

/** Best-effort HTML→readable-text: drop script/style/comments, tags to spaces. */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncateText(
  text: string,
  max = MAX_TEXT,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n... (content truncated)`, truncated: true };
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @artificer/runtime test`
Expected: PASS — fetch-util tests + earlier memory-search tests all pass.

- [ ] **Step 5: Implement the tool.** Create `packages/runtime/src/tools/fetch.ts`:

```ts
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { extractTitle, htmlToText, truncateText } from './fetch-util.js';

/** A tool to read a web page / text resource over HTTP(S). */
export function createFetchTools(_ctx: ToolContext): ToolDef[] {
  return [
    {
      name: 'fetch_url',
      description:
        'Fetch a web page or text resource over HTTP(S) and return its readable text. Use this to read a link the user shared.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The http(s) URL to fetch.' },
        },
        required: ['url'],
      },
      handler: async (input) => {
        const url = String(input.url);
        if (!/^https?:\/\//i.test(url)) {
          return `Error: only http(s) URLs are supported (got "${url}").`;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const res = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'user-agent': 'ArtificerBot/0.1 (+memory ingestion)' },
          });
          if (!res.ok) {
            return `Error: fetch failed with HTTP ${res.status} ${res.statusText}.`;
          }
          const contentType = res.headers.get('content-type') ?? '';
          const raw = await res.text();
          const isHtml = contentType.includes('html') || /<html[\s>]/i.test(raw);
          const title = isHtml ? extractTitle(raw) : undefined;
          const body = isHtml ? htmlToText(raw) : raw.trim();
          const { text, truncated } = truncateText(body);
          const header = [
            `URL: ${url}`,
            title ? `Title: ${title}` : null,
            truncated ? '(content truncated)' : null,
          ]
            .filter(Boolean)
            .join('\n');
          return `${header}\n\n${text}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error fetching ${url}: ${msg}`;
        } finally {
          clearTimeout(timer);
        }
      },
    },
  ];
}
```

- [ ] **Step 6: Type-check.**

Run: `pnpm --filter @artificer/runtime type-check`
Expected: Still the known errors from Tasks 3/4 (RoleName records, orchestrator-tool). No NEW errors from `fetch.ts`/`fetch-util.ts`. Proceed.

- [ ] **Step 7: Commit.**

```bash
git add packages/runtime/src/tools/fetch-util.ts packages/runtime/src/tools/fetch-util.test.ts packages/runtime/src/tools/fetch.ts
git commit -m "feat(runtime): add fetch_url tool and html-to-text helpers"
```

---

## Task 6: Librarian role (definition, tier, registry)

**Files:**
- Modify: `packages/runtime/src/engine/models.ts:20-26`
- Modify: `packages/runtime/src/engine/roles.ts` (add role, add to `ROLES`, update communicator prompt)
- Modify: `packages/runtime/src/tools/registry.ts`

- [ ] **Step 1: Add the librarian tier.** In `models.ts`, update `DEFAULT_ROLE_TIER`:

```ts
export const DEFAULT_ROLE_TIER: Record<RoleName, ModelTier> = {
  communicator: 'low',
  orchestrator: 'medium',
  planner: 'high',
  reviewer: 'medium',
  worker: 'high',
  librarian: 'medium',
};
```

- [ ] **Step 2: Add the librarian role definition.** In `roles.ts`, add this constant just before the `const ROLES` declaration:

```ts
const LIBRARIAN: RoleDefinition = {
  name: 'librarian',
  blurb: 'Reads shared links/content and saves durable knowledge to memory.',
  system: (agentName) =>
    `You are ${agentName}'s LIBRARIAN. Someone shared a link or some content to teach you something. Learn it and store durable knowledge in long-term memory.

Process:
1. If you were given a URL, call fetch_url to read it. If you were given raw content, use it directly.
2. Identify the durable, teachable facts: preferences, decisions, how things work, reference details. Ignore navigation, ads, and transient fluff.
3. Before saving, call query_memories to avoid duplicating what you already know.
4. Save each distinct fact with add_memory: give a short title, a one-line summary, useful tags, and the source (the URL, or "conversation"). Prefer several focused memories over one giant blob.
5. Finish by calling reply with a brief 2-4 bullet summary of what you learned. If you could not read the material (e.g. the fetch failed), say so and save nothing.

Keep each memory concise and self-contained so it is useful when recalled out of context.`,
};
```

- [ ] **Step 3: Register the role.** In `roles.ts`, add `librarian` to the `ROLES` record:

```ts
const ROLES: Record<RoleName, RoleDefinition> = {
  communicator: COMMUNICATOR,
  orchestrator: ORCHESTRATOR,
  planner: PLANNER,
  reviewer: REVIEWER,
  worker: WORKER,
  librarian: LIBRARIAN,
};
```

- [ ] **Step 4: Update the communicator prompt.** In `roles.ts`, in the `COMMUNICATOR.system` string, add a bullet to the decision list (after the "steer existing work" bullet, before the "question or chat" bullet):

```
- If they are sharing something for you to learn or remember (a link to read, reference material, "remember this", "read this and learn it"), call learn with the link or the content.
```

- [ ] **Step 5: Wire fetch tools + librarian into the registry.** In `registry.ts`, add the import near the other tool imports:

```ts
import { createFetchTools } from './fetch.js';
```

Then inside `toolsForRole`, add the factory call near the others:

```ts
  const fetchTools = createFetchTools(ctx);
```

And add a `librarian` case to the `switch` (before `default`):

```ts
    case 'librarian':
      return [
        ...fetchTools,
        ...reply,
        ...byName(orchestrator, ['query_memories', 'add_memory']),
      ];
```

- [ ] **Step 6: Type-check.**

Run: `pnpm --filter @artificer/runtime type-check`
Expected: The RoleName-record errors from Task 3 are now resolved. Remaining errors are ONLY in `orchestrator-tool.ts` (old `addMemory`/`searchMemories` calls) and `communication.ts` will be fine. Proceed to Task 7 to clear the rest.

- [ ] **Step 7: Commit.**

```bash
git add packages/runtime/src/engine/models.ts packages/runtime/src/engine/roles.ts packages/runtime/src/tools/registry.ts
git commit -m "feat(runtime): add librarian role and wire its tools"
```

---

## Task 7: Upgrade memory tools (`query_memories`, `add_memory`)

**Files:**
- Modify: `packages/runtime/src/tools/orchestrator-tool.ts:188-231`

- [ ] **Step 1: Replace the `query_memories` tool object** with:

```ts
    {
      name: 'query_memories',
      description:
        "Search the agent's long-term memory for relevant notes. Returns the top matches only. Leave query empty to list recent memories.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tag filter; only memories with these tags are considered.',
          },
          limit: {
            type: 'number',
            description: 'Max memories to return (default 5).',
          },
        },
      },
      handler: async (input) => {
        const tags = Array.isArray(input.tags)
          ? (input.tags as unknown[]).map(String)
          : undefined;
        const limit =
          typeof input.limit === 'number' ? input.limit : undefined;
        const memories = await store.queryMemories(
          input.query ? String(input.query) : '',
          { tags, limit },
        );
        if (memories.length === 0) return '(no memories)';
        return memories
          .map((m) => {
            const head = m.title ?? m.content.slice(0, 60);
            const tagStr = m.tags.length ? ` [${m.tags.join(', ')}]` : '';
            const src = m.source ? ` (source: ${m.source})` : '';
            return `- ${head}${tagStr}${src}\n  ${m.content}`;
          })
          .join('\n\n');
      },
    },
```

- [ ] **Step 2: Replace the `add_memory` tool object** with:

```ts
    {
      name: 'add_memory',
      description:
        'Save a durable note to long-term memory (a decision, a fact, a preference, something learned). Give it a title, tags, and a source when you can.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The note to remember.' },
          title: { type: 'string', description: 'Short label for the memory.' },
          summary: { type: 'string', description: 'One-line gist used for recall.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for retrieval.',
          },
          source: {
            type: 'string',
            description: 'Where it came from: a URL, or "conversation".',
          },
          kind: {
            type: 'string',
            enum: ['note', 'document'],
            description: 'Optional kind of memory.',
          },
        },
        required: ['content'],
      },
      handler: async (input) => {
        const tags = Array.isArray(input.tags)
          ? (input.tags as unknown[]).map(String)
          : [];
        const kind =
          input.kind === 'document' || input.kind === 'note'
            ? input.kind
            : undefined;
        const memory = await store.addMemory({
          content: String(input.content),
          tags,
          title: input.title ? String(input.title) : undefined,
          summary: input.summary ? String(input.summary) : undefined,
          source: input.source ? String(input.source) : undefined,
          kind,
        });
        return `Saved to memory (${memory.id}).`;
      },
    },
```

- [ ] **Step 3: Type-check.**

Run: `pnpm --filter @artificer/runtime type-check`
Expected: PASS — no errors. (All earlier expected errors are now resolved.)

- [ ] **Step 4: Run tests.**

Run: `pnpm --filter @artificer/runtime test`
Expected: PASS — memory-search + fetch-util tests pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/runtime/src/tools/orchestrator-tool.ts
git commit -m "feat(runtime): richer query_memories and add_memory tools"
```

---

## Task 8: `learn` tool (communicator → librarian)

**Files:**
- Modify: `packages/runtime/src/tools/communication.ts` (inside `createCommunicatorTools`, add to the returned array)

- [ ] **Step 1: Add the `learn` tool.** In `createCommunicatorTools`, add this object to the returned array (after the `send_note` tool object, still inside the array):

```ts
    {
      name: 'learn',
      description:
        'Hand off a link or piece of content for the agent to read and remember. Use when the person is teaching you something or sharing reference material to keep.',
      inputSchema: {
        type: 'object',
        properties: {
          material: {
            type: 'string',
            description: 'The URL to read, or the raw content to learn from.',
          },
          note: {
            type: 'string',
            description: 'Optional instruction about what to focus on.',
          },
        },
        required: ['material'],
      },
      handler: async (input) => {
        const material = String(input.material);
        const focus = input.note ? `\nFocus: ${String(input.note)}` : '';
        const { runId } = await engine.spawnCall({
          role: 'librarian',
          description: `Learn from this and save what matters to memory:\n${material}${focus}`,
          parentRunId: run.id,
          originMessageId: run.originMessageId,
        });
        return `Librarian call ${runId} started; it will read and remember this in the background.`;
      },
    },
```

- [ ] **Step 2: Type-check.**

Run: `pnpm --filter @artificer/runtime type-check`
Expected: PASS — `engine.spawnCall` accepts `role: 'librarian'` (now part of `RoleName`).

- [ ] **Step 3: Commit.**

```bash
git add packages/runtime/src/tools/communication.ts
git commit -m "feat(runtime): add learn tool to spawn librarian ingestion"
```

---

## Task 9: Memory signpost in context

**Files:**
- Modify: `packages/runtime/src/engine/call.ts:48-50`

- [ ] **Step 1: Replace the static memory hint.** In `buildContext`, replace the existing `sections.push('You can use get_status to query more detail and query_memories to recall past notes.');` block with:

```ts
  const signpost = await store.memorySignpost();
  sections.push(
    [
      'You can use get_status to query more detail.',
      signpost ??
        'You have no memories saved yet; use add_memory to remember durable facts.',
    ].join(' '),
  );
```

- [ ] **Step 2: Type-check.**

Run: `pnpm --filter @artificer/runtime type-check`
Expected: PASS — `store.memorySignpost()` exists (Task 4); `buildContext` already receives `store`.

- [ ] **Step 3: Commit.**

```bash
git add packages/runtime/src/engine/call.ts
git commit -m "feat(runtime): inject memory signpost into call context"
```

---

## Task 10: `GET /memories` endpoint

**Files:**
- Modify: `packages/runtime/src/server/app.ts` (after the `GET /workstreams/:id` route, before `// --- Observability` is fine)

- [ ] **Step 1: Add the route.** Insert into `createApp`, near the other routes:

```ts
  // --- Memories ---

  app.get('/memories', async (c) => {
    const q = c.req.query('q');
    if (q) {
      const memories = await engine.store.queryMemories(q, { limit: 20 });
      return c.json({ memories });
    }
    const memories = await engine.store.listMemories();
    memories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({ memories });
  });
```

- [ ] **Step 2: Type-check.**

Run: `pnpm --filter @artificer/runtime type-check`
Expected: PASS.

- [ ] **Step 3: Manual smoke test.** Start the runtime and hit the endpoint:

Run: `pnpm --filter @artificer/runtime dev` (in one terminal), then in another:
`curl -s localhost:4100/memories | head -c 200`
Expected: JSON `{"memories":[...]}` (possibly `{"memories":[]}` if none yet). Stop the dev server after.

- [ ] **Step 4: Commit.**

```bash
git add packages/runtime/src/server/app.ts
git commit -m "feat(runtime): add GET /memories endpoint"
```

---

## Task 11: UI — Memories page

**Files:**
- Modify: `apps/runtime-ui/src/api/types.ts` (add `Memory`, extend `RoleName`)
- Modify: `apps/runtime-ui/src/api/hooks.ts` (add `useMemories`)
- Create: `apps/runtime-ui/src/pages/MemoriesPage.tsx`
- Modify: `apps/runtime-ui/src/App.tsx` (nav + route)

- [ ] **Step 1: Add the `Memory` type and extend `RoleName`.** In `apps/runtime-ui/src/api/types.ts`, update the `RoleName` union to include `'librarian'`:

```ts
export type RoleName =
  | 'communicator'
  | 'orchestrator'
  | 'planner'
  | 'reviewer'
  | 'worker'
  | 'librarian';
```

And add (e.g. just after the `RoleName` type):

```ts
export interface Memory {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  title?: string;
  summary?: string;
  source?: string;
  kind?: 'note' | 'document';
  updatedAt?: string;
}
```

- [ ] **Step 2: Add the `useMemories` hook.** In `apps/runtime-ui/src/api/hooks.ts`, add the `Memory` import to the existing `import type { ... } from './types'` block, then add:

```ts
export function useMemories(q?: string) {
  return useQuery({
    queryKey: ['memories', q ?? ''],
    queryFn: () =>
      api.get<{ memories: Memory[] }>(
        `/memories${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
    refetchInterval: 5000,
    select: (d) => d.memories,
  });
}
```

- [ ] **Step 3: Create the Memories page.** Create `apps/runtime-ui/src/pages/MemoriesPage.tsx`:

```tsx
import {
  Anchor,
  Badge,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useMemories } from '../api/hooks';
import type { Memory } from '../api/types';
import { relativeTime } from '../format';

function isUrl(s: string | undefined): s is string {
  return Boolean(s && /^https?:\/\//i.test(s));
}

function MemoryCard({ memory }: { memory: Memory }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Group justify="space-between" mb={4} wrap="nowrap">
        <Text fw={600} lineClamp={1}>
          {memory.title ?? memory.content.slice(0, 60)}
        </Text>
        <Text size="xs" c="dimmed">
          {relativeTime(memory.createdAt)}
        </Text>
      </Group>
      {memory.summary && (
        <Text size="sm" c="dimmed" mb={6}>
          {memory.summary}
        </Text>
      )}
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
        {memory.content}
      </Text>
      <Group gap="xs" mt="sm">
        {memory.tags.map((t) => (
          <Badge key={t} variant="light" radius="sm">
            {t}
          </Badge>
        ))}
        {isUrl(memory.source) ? (
          <Anchor href={memory.source} target="_blank" size="xs">
            source
          </Anchor>
        ) : memory.source ? (
          <Text size="xs" c="dimmed">
            source: {memory.source}
          </Text>
        ) : null}
      </Group>
    </Card>
  );
}

export function MemoriesPage() {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 300);
  const { data, isLoading } = useMemories(debounced.trim() || undefined);

  return (
    <Stack gap="lg">
      <Title order={3}>Memories</Title>
      <TextInput
        leftSection={<IconSearch size={16} />}
        placeholder="Search memories…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      {isLoading && <Loader size="sm" />}
      {data?.length === 0 && (
        <Text c="dimmed" size="sm">
          {debounced.trim()
            ? 'No memories match your search.'
            : 'No memories yet. Send the agent a link or some content to teach it something.'}
        </Text>
      )}
      <Stack gap="sm">
        {data?.map((m) => (
          <MemoryCard key={m.id} memory={m} />
        ))}
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 4: Add nav entry + route.** In `apps/runtime-ui/src/App.tsx`:

Add `IconBook` to the `@tabler/icons-react` import:

```tsx
import {
  IconActivity,
  IconBook,
  IconCoin,
  IconLayoutDashboard,
} from '@tabler/icons-react';
```

Add the page import next to the other page imports:

```tsx
import { MemoriesPage } from './pages/MemoriesPage';
```

Add a nav item to the `NAV` array (after Workstreams):

```tsx
  { to: '/memories', label: 'Memories', icon: IconBook },
```

Add the route inside `<Routes>` (after the workstreams routes):

```tsx
          <Route path="/memories" element={<MemoriesPage />} />
```

- [ ] **Step 5: Type-check and build.**

Run: `pnpm --filter @artificer/runtime-ui type-check && pnpm --filter @artificer/runtime-ui build`
Expected: PASS — both succeed. (`useDebouncedValue` ships with `@mantine/hooks`, already a dependency.)

- [ ] **Step 6: Commit.**

```bash
git add apps/runtime-ui/src/api/types.ts apps/runtime-ui/src/api/hooks.ts apps/runtime-ui/src/pages/MemoriesPage.tsx apps/runtime-ui/src/App.tsx
git commit -m "feat(runtime-ui): add Memories page"
```

---

## Task 12: End-to-end verification

**Files:** none (manual verification + optional README note)

- [ ] **Step 1: Full type-check + tests across both packages.**

Run:
```bash
pnpm --filter @artificer/runtime type-check
pnpm --filter @artificer/runtime test
pnpm --filter @artificer/runtime-ui type-check
pnpm --filter @artificer/runtime-ui build
```
Expected: all PASS.

- [ ] **Step 2: Start runtime + UI.**

Run (two terminals): `pnpm --filter @artificer/runtime dev` and `pnpm --filter @artificer/runtime-ui dev`.
Expected: runtime on `:4100`, UI on `:5173`.

- [ ] **Step 3: Teach via a URL.** In the Dashboard composer, send: `Read this and remember the key points: https://example.com`.
Expected: the communicator replies that it's learning; in the Usage page / message call tree a `librarian` run appears; on the Memories page one or more new memories appear (title, tags, source = the URL).

- [ ] **Step 4: Teach via raw content.** Send: `Remember this: our prod deploys run every Tuesday at 10am PT via the deploy bot.`
Expected: a librarian run; a memory tagged something like `deploy`/`ops` with source `conversation`.

- [ ] **Step 5: Confirm recall + signpost.** Send: `When do we deploy to prod?`
Expected: the communicator's reply reflects the taught fact (it called `query_memories`). The signpost (`You have N memories (topics: …)`) is present in the communicator's context for that run.

- [ ] **Step 6: Confirm a failed fetch saves nothing.** Send: `Learn from https://nonexistent.invalid/page`.
Expected: the librarian replies that it couldn't read the material; no new memory is created.

- [ ] **Step 7 (optional): Document.** Add a short "Teaching the agent / memory" paragraph to `packages/runtime/README.md` describing the `learn` flow, the `librarian` role, and `RUNTIME_TIER_LIBRARIAN` override. Commit:

```bash
git add packages/runtime/README.md
git commit -m "docs(runtime): document memory teaching flow"
```

---

## Self-Review

**Spec coverage:**
- Entry point = normal channel → Task 6 (communicator prompt) + Task 8 (`learn`). ✓
- Async librarian (approach A) → Tasks 5, 6, 8. ✓
- Keyword-only, pluggable ranker → Task 2 (`rankMemories` isolated). ✓
- Pull-only recall → Task 4 (`queryMemories`) + Task 7 (tool); no content injected. ✓
- Signpost → Task 4 (`memorySignpost`) + Task 9 (context). ✓
- Enriched Memory + `index.json` → Tasks 3, 4. ✓
- `fetch_url` (HTML→text, cap, errors) → Task 5. ✓
- Memories UI + `GET /memories` → Tasks 10, 11. ✓
- Errors/dedup/index rebuild → Task 4 (`readMemoryIndex` rebuild), Task 5 (fetch errors), librarian prompt (dedup via query_memories). ✓
- Testing → Tasks 2, 5 (unit), Task 12 (e2e). ✓

**Type consistency:** `addMemory(input: {...})` is defined in Task 4 and called with the object form in Tasks 7 and (implicitly) librarian via the tool. `queryMemories(query, { tags?, limit? })` defined in Task 4, used in Tasks 7 and 10. `memorySignpost()` defined in Task 4, used in Task 9. `MemoryIndexEntry`/`rankMemories`/`tokenize` defined in Task 2, used in Task 4. `RoleName` gains `'librarian'` in Task 3 and is satisfied in Task 6 (`DEFAULT_ROLE_TIER`, `ROLES`) and the registry switch. UI `Memory`/`useMemories` defined in Task 11. No dangling references.

**Placeholder scan:** No TBD/TODO; every code step has complete code and exact commands with expected output.
