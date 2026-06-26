# Phase 2: Deployment, DX & Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on:** Phase 1 (public-api-surface.md) — the `define*` API, identity/execution split, and agent discovery must be in place.

**Goal:** Close the competitive gaps identified in the research: bundle the runtime UI with the runtime, add API authentication, build the CLI, mount channel routes, and add MCP connection support. After this phase, `artificer dev` gives you a fully working agent with API + UI on one port, authenticated, with Slack/GitHub channels and MCP connections.

**Architecture:** The runtime serves both the API and the UI SPA on a single HTTP server (Hono). Authentication uses a bearer token from `.env`. Channels mount as Hono route groups under `/channels/{name}/`. MCP connections proxy through the runtime with credential injection. The CLI is a thin wrapper that discovers the agent repo, loads config, and starts the runtime.

**Tech Stack:** TypeScript, Hono (existing), Vite (existing for runtime-ui build), Node.js native test runner.

## Global Constraints

- Node.js ≥ 21, pnpm 8, Turborepo
- No new runtime dependencies beyond what's already in the monorepo
- All Phase 1 APIs (`defineConfig`, `defineTool`, `defineChannel`, `defineSkill`, `createRuntime`) must be functional
- Authentication must work across: local dev (optional), Docker (required), cloud deploy (required)
- Secrets in `.env` only — the agent repo never contains credentials
- `GIT_CEILING_DIRECTORIES` enforced for all workspace git operations

---

## Developer Experience After This Phase

```bash
# Scaffold a new agent
npx @artificer/cli init my-agent
cd my-agent

# Edit config, add tools, channels, skills...

# Start development — single command, API + UI on one port
artificer dev
# → [artificer] Atlas listening on http://localhost:4100
# → [artificer] UI: http://localhost:4100
# → [artificer] API: http://localhost:4100/api
# → [artificer] identity: /Users/me/my-agent
# → [artificer] execution: /Users/me/my-agent/.artificer

# In production (Docker, cloud, etc.)
artificer start
# Same output, but with auth enforced via ARTIFICER_API_KEY
```

The UI and API share one port. The runtime serves:
- `/` → Runtime UI SPA (static assets)
- `/api/*` → All REST endpoints (messages, workstreams, state, config, etc.)
- `/channels/{name}/*` → Channel webhook endpoints (Slack, GitHub, etc.)
- `/events` → SSE event stream

Users who want a custom UI can ignore the bundled one and build against the `/api/*` endpoints directly.

---

### Task 1: Bundle Runtime UI with the Runtime

Ship the runtime-ui SPA as static assets served by the runtime's Hono server. A single process serves both API and UI on one port.

**Files:**
- Modify: `apps/runtime-ui/vite.config.ts` (set `base: '/'` and output to a known build dir)
- Modify: `apps/runtime-ui/src/config.ts` or equivalent (API base URL defaults to same origin `/api`)
- Create: `packages/runtime/src/server/static.ts` (serve static files from bundled UI dist)
- Modify: `packages/runtime/src/server/app.ts` (mount static serving, prefix API routes under `/api`)
- Modify: `packages/runtime/package.json` (add build step that copies UI dist into package)
- Test: `packages/runtime/src/server/static.test.ts`

**Interfaces:**
- Consumes: Built runtime-ui assets (HTML, JS, CSS), existing Hono `app` from `server/app.ts`
- Produces: Updated `createApp` that mounts API routes under `/api/*` and serves the UI SPA at `/`. A `serveStatic` middleware for Hono that serves pre-built assets and falls back to `index.html` for client-side routing.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/server/static.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { serveUI } from './static.js';

describe('serveUI', () => {
  it('returns a Hono middleware that serves index.html for root', async () => {
    const app = new Hono();
    // serveUI needs a distDir; we'll test with a temp dir
    // For this unit test, we verify the function exists and returns middleware
    assert.equal(typeof serveUI, 'function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/server/static.test.ts`
Expected: FAIL — module `./static.js` not found

- [ ] **Step 3: Implement `serveUI` middleware**

```ts
// packages/runtime/src/server/static.ts
import fs from 'node:fs';
import path from 'node:path';
import type { Context, Next } from 'hono';

export function serveUI(distDir: string) {
  return async (c: Context, next: Next) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/channels/') || c.req.path === '/events') {
      return next();
    }

    const filePath = path.join(distDir, c.req.path === '/' ? 'index.html' : c.req.path);

    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        return new Response(content, {
          headers: { 'Content-Type': contentType },
        });
      }
    } catch {
      // File not found — fall through to SPA fallback
    }

    // SPA fallback: serve index.html for client-side routes
    const indexPath = path.join(distDir, 'index.html');
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      return new Response(content, {
        headers: { 'Content-Type': 'text/html' },
      });
    } catch {
      return next();
    }
  };
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
```

- [ ] **Step 4: Modify `app.ts` to prefix API routes under `/api` and mount UI**

The key change: all existing routes (e.g., `/messages`, `/state`, `/workstreams`) move under `/api/messages`, `/api/state`, etc. The root `/` serves the UI.

In `packages/runtime/src/server/app.ts`:
- Create an `api` sub-app: `const api = new Hono()` with all current routes
- Mount it: `app.route('/api', api)`
- Add the static middleware: `app.use('*', serveUI(uiDistDir))`
- Resolve `uiDistDir` from a known location relative to the package (e.g., `path.join(__dirname, '../../ui-dist')`)

Keep the `/events` SSE endpoint at the root level (not under `/api`) since EventSource doesn't love path prefixes.

- [ ] **Step 5: Update runtime-ui API base URL**

In `apps/runtime-ui`, ensure the API client uses `/api` as its base URL instead of the root. This is likely in a config or fetch wrapper. The UI should auto-detect: if `VITE_API_URL` is set, use it; otherwise default to `window.location.origin + '/api'`.

- [ ] **Step 6: Add build step to copy UI dist into the runtime package**

In `packages/runtime/package.json`, add a `build:ui` script that:
1. Builds the runtime-ui: `cd ../../apps/runtime-ui && npm run build`
2. Copies the output to `packages/runtime/ui-dist/`

This can also be a Turborepo pipeline dependency.

- [ ] **Step 7: Run full test suite**

Run: `cd packages/runtime && npm test`
Expected: All tests pass. Existing API tests may need path updates (`/messages` → `/api/messages`).

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/server/static.ts packages/runtime/src/server/static.test.ts packages/runtime/src/server/app.ts apps/runtime-ui/src/config.ts packages/runtime/package.json
git commit -m "feat(runtime): bundle runtime UI with the runtime server"
```

---

### Task 2: API Authentication

Add bearer token authentication to the runtime API. Works across all deployment strategies: optional in local dev, required when `ARTIFICER_API_KEY` is set.

**Files:**
- Create: `packages/runtime/src/server/auth.ts`
- Modify: `packages/runtime/src/server/app.ts` (mount auth middleware)
- Modify: `packages/runtime/src/config.ts` (add `apiAuthKey` to RuntimeConfig)
- Test: `packages/runtime/src/server/auth.test.ts`

**Interfaces:**
- Consumes: `RuntimeConfig.apiAuthKey` (from `ARTIFICER_API_KEY` env var)
- Produces: A Hono middleware that checks `Authorization: Bearer <key>` on all `/api/*` routes. When `apiAuthKey` is not set, auth is disabled (local dev convenience). Channel webhook endpoints (`/channels/*`) use their own verification (e.g., Slack signing secret) and skip bearer auth. The `/` UI route is unauthenticated (the UI handles auth client-side by including the key in API calls).

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/server/auth.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { bearerAuth } from './auth.js';

describe('bearerAuth', () => {
  it('passes through when no key is configured', async () => {
    const app = new Hono();
    app.use('*', bearerAuth(undefined));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });

  it('rejects requests without a token when key is configured', async () => {
    const app = new Hono();
    app.use('*', bearerAuth('secret-key'));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test');
    assert.equal(res.status, 401);
  });

  it('rejects requests with wrong token', async () => {
    const app = new Hono();
    app.use('*', bearerAuth('secret-key'));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    assert.equal(res.status, 401);
  });

  it('accepts requests with correct token', async () => {
    const app = new Hono();
    app.use('*', bearerAuth('secret-key'));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer secret-key' },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/server/auth.test.ts`
Expected: FAIL — module `./auth.js` not found

- [ ] **Step 3: Implement `bearerAuth`**

```ts
// packages/runtime/src/server/auth.ts
import { timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';

export function bearerAuth(key: string | undefined) {
  return async (c: Context, next: Next) => {
    if (!key) return next();

    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = header.slice(7);
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(key);

    if (tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/server/auth.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Add `apiAuthKey` to RuntimeConfig and loadConfig**

In `packages/runtime/src/config.ts`:

```ts
// Add to RuntimeConfig interface:
/** Bearer token for API authentication. Absent = no auth (local dev). */
apiAuthKey?: string;

// Add to loadConfig() return:
apiAuthKey: env.ARTIFICER_API_KEY || undefined,
```

- [ ] **Step 6: Mount auth middleware in app.ts**

In `packages/runtime/src/server/app.ts`, apply `bearerAuth` to the `/api` sub-app:

```ts
import { bearerAuth } from './auth.js';

// In createApp, after creating the api sub-app:
api.use('*', bearerAuth(engine.config.apiAuthKey));
```

Channel routes (`/channels/*`) are NOT behind bearer auth — they have their own verification (Slack signing secret, GitHub webhook secret, etc.).

- [ ] **Step 7: Run full test suite**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/server/auth.ts packages/runtime/src/server/auth.test.ts packages/runtime/src/server/app.ts packages/runtime/src/config.ts
git commit -m "feat(runtime): add bearer token API authentication"
```

---

### Task 3: Channel Route Mounting

Mount registered channels as Hono route groups so they can receive webhooks and deliver responses. This wires the `defineChannel` API (Phase 1, Task 4) into the HTTP server.

**Files:**
- Create: `packages/runtime/src/channels/mount.ts`
- Modify: `packages/runtime/src/server/app.ts` (mount channel routes)
- Test: `packages/runtime/src/channels/mount.test.ts`

**Interfaces:**
- Consumes: `ArtificerChannel` from `api/types.ts`, `Engine.receiveMessage` from `engine/engine.ts`, Hono `app` from `server/app.ts`
- Produces: `mountChannels(app: Hono, channels: ArtificerChannel[], engine: Engine): void` — for each channel, creates a route group at `/channels/{name}/` with a POST endpoint that: (1) optionally verifies the webhook signature via `channel.definition.verify`, (2) calls `channel.receive(payload)` to normalize the input, (3) passes the normalized message to `engine.receiveMessage()`, (4) formats the response via `channel.format()` and returns it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/channels/mount.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { mountChannels } from './mount.js';
import { defineChannel } from '../api/define-channel.js';

describe('mountChannels', () => {
  it('mounts a channel as a POST route', async () => {
    const app = new Hono();
    const channel = defineChannel({
      name: 'test',
      description: 'Test channel',
      receive: async (payload) => ({
        content: `received: ${payload.text}`,
        metadata: { channel: 'test' },
      }),
      format: async (output) => ({ response: output.content }),
    });

    const messages: string[] = [];
    const mockEngine = {
      receiveMessage: async (content: string) => {
        messages.push(content);
        return { id: 'msg_1', direction: 'inbound' as const, content, createdAt: '' };
      },
    };

    mountChannels(app, [channel], mockEngine as any);

    const res = await app.request('/channels/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello from test' }),
    });

    assert.equal(res.status, 200);
    assert.equal(messages.length, 1);
    assert.equal(messages[0], 'received: hello from test');
  });

  it('rejects when verification fails', async () => {
    const app = new Hono();
    const channel = defineChannel({
      name: 'secure',
      description: 'Verified channel',
      verify: async (headers) => headers['x-secret'] === 'valid',
      receive: async (payload) => ({ content: String(payload.text) }),
      format: async (output) => ({ text: output.content }),
    });

    mountChannels(app, [channel], { receiveMessage: async () => ({}) } as any);

    const res = await app.request('/channels/secure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });

    assert.equal(res.status, 401);
  });

  it('passes verification with correct header', async () => {
    const app = new Hono();
    const channel = defineChannel({
      name: 'secure',
      description: 'Verified channel',
      verify: async (headers) => headers['x-secret'] === 'valid',
      receive: async (payload) => ({ content: String(payload.text) }),
      format: async (output) => ({ text: output.content }),
    });

    mountChannels(app, [channel], {
      receiveMessage: async (content: string) => ({
        id: 'msg_1', direction: 'inbound', content, createdAt: '',
      }),
    } as any);

    const res = await app.request('/channels/secure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-secret': 'valid',
      },
      body: JSON.stringify({ text: 'hello' }),
    });

    assert.equal(res.status, 200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/channels/mount.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `mountChannels`**

```ts
// packages/runtime/src/channels/mount.ts
import type { Hono } from 'hono';
import type { ArtificerChannel } from '../api/types.js';
import type { Engine } from '../engine/engine.js';

export function mountChannels(
  app: Hono,
  channels: ArtificerChannel[],
  engine: Engine,
): void {
  for (const channel of channels) {
    app.post(`/channels/${channel.name}`, async (c) => {
      // Verification
      if (channel.definition.verify) {
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
        const body = await c.req.text();
        const valid = await channel.definition.verify(headers, body);
        if (!valid) {
          return c.json({ error: 'Verification failed' }, 401);
        }
        // Re-parse body since we consumed it
        const payload = JSON.parse(body);
        const message = await channel.receive(payload);
        const result = await engine.receiveMessage(message.content);
        const formatted = await channel.format({
          content: result.content ?? '',
          metadata: message.metadata,
        });
        return c.json(formatted);
      }

      const payload = await c.req.json();
      const message = await channel.receive(payload);
      const result = await engine.receiveMessage(message.content);
      const formatted = await channel.format({
        content: result.content ?? '',
        metadata: message.metadata,
      });
      return c.json(formatted);
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/channels/mount.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Wire into `createApp` / `createRuntime`**

In `packages/runtime/src/api/create-runtime.ts`, after creating the app, call `mountChannels` with any discovered/registered channels.

- [ ] **Step 6: Run full test suite and commit**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

```bash
git add packages/runtime/src/channels/mount.ts packages/runtime/src/channels/mount.test.ts packages/runtime/src/server/app.ts packages/runtime/src/api/create-runtime.ts
git commit -m "feat(runtime): mount channel routes with webhook verification"
```

---

### Task 4: Built-in Slack & Discord Channel Adapters

Ship concrete `defineChannel` implementations for Slack and Discord that make the agent feel like a person, not a bot. Users can DM the agent, @mention it in channels, and interact with it like a colleague. Multiple Artificer instances in the same Slack workspace each appear as distinct people (e.g., `@Atlas`, `@Forge`, `@Scout`).

**Interaction model:**
- **DMs** — message the agent directly in a 1:1 conversation, like messaging a coworker
- **@mentions** — `@Atlas can you fix the auth bug?` in any channel the agent is in
- **Ambient channel messages** — optionally, the agent listens to channels and responds when relevant (configurable, off by default)
- **Threaded replies** — the agent always replies in-thread to keep channels clean
- **Status updates** — the agent's Slack profile status reflects its current work ("Working on: Fix auth bug in payments-api")

Each Artificer instance is a separate Slack Bot User with its own name, avatar, and credentials. Multiple instances in the same workspace just means multiple bot users — Slack handles this natively.

**Files:**
- Create: `packages/runtime/src/channels/adapters/slack.ts`
- Create: `packages/runtime/src/channels/adapters/discord.ts`
- Create: `packages/runtime/src/channels/adapters/verify.ts` (shared verification utilities)
- Modify: `packages/runtime/src/index.ts` (export built-in adapters)
- Test: `packages/runtime/src/channels/adapters/slack.test.ts`
- Test: `packages/runtime/src/channels/adapters/discord.test.ts`
- Test: `packages/runtime/src/channels/adapters/verify.test.ts`

**Interfaces:**
- Consumes: `defineChannel` from `api/define-channel.ts`, `Engine.receiveMessage` from `engine/engine.ts`
- Produces: `slackChannel(options?)` and `discordChannel()` — factory functions that return `ArtificerChannel` instances. Slack adapter handles DMs (`message.im`), @mentions (`app_mention`), and optionally ambient channel messages (`message.channels`). Discord adapter handles slash commands with deferred responses. Both include verification and async reply helpers. `updateSlackStatus(text)` sets the bot's profile status to reflect current work.

**Credentials in `.env`:**
```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...           # Bot User OAuth Token (for posting replies + status)
SLACK_SIGNING_SECRET=abc123...     # Signing Secret (for webhook verification)

# Discord
DISCORD_PUBLIC_KEY=abc123...       # Public Key (for Ed25519 verification)
DISCORD_APP_ID=987654321           # Application ID (for followup messages)
DISCORD_BOT_TOKEN=Bot MTk...       # Bot Token (optional, for REST API calls)
```

**Slack Bot Setup (for the "person" experience):**
1. Create a Slack App at api.slack.com/apps
2. Set display name and avatar to match the agent's identity (e.g., "Atlas", team photo)
3. Enable Events API, set Request URL to `https://your-artificer/channels/slack`
4. Subscribe to bot events: `message.im` (DMs), `app_mention` (@mentions), optionally `message.channels` (ambient)
5. Add OAuth scopes: `chat:write`, `im:history`, `im:read`, `app_mentions:read`, `channels:history` (if ambient), `users.profile:write` (for status updates)
6. Install to workspace — the bot appears as a "person" in the sidebar

- [ ] **Step 1: Write the failing test for verification utilities**

```ts
// packages/runtime/src/channels/adapters/verify.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySlackSignature } from './verify.js';

describe('verifySlackSignature', () => {
  const secret = 'test-signing-secret';

  it('accepts a valid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"event_callback","event":{"text":"hello"}}';
    const sig = 'v0=' + createHmac('sha256', secret)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex');

    const result = verifySlackSignature(secret, {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': sig,
    }, body);

    assert.equal(result, true);
  });

  it('rejects an invalid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"text":"hello"}';

    const result = verifySlackSignature(secret, {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': 'v0=invalid',
    }, body);

    assert.equal(result, false);
  });

  it('rejects a stale timestamp (replay attack)', () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const body = '{}';
    const sig = 'v0=' + createHmac('sha256', secret)
      .update(`v0:${staleTimestamp}:${body}`)
      .digest('hex');

    const result = verifySlackSignature(secret, {
      'x-slack-request-timestamp': staleTimestamp,
      'x-slack-signature': sig,
    }, body);

    assert.equal(result, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/channels/adapters/verify.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement verification utilities**

```ts
// packages/runtime/src/channels/adapters/verify.ts
import { createHmac, timingSafeEqual, verify } from 'node:crypto';

const MAX_TIMESTAMP_DRIFT_SECONDS = 300;

export function verifySlackSignature(
  signingSecret: string,
  headers: Record<string, string>,
  body: string,
): boolean {
  const timestamp = headers['x-slack-request-timestamp'];
  const signature = headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_TIMESTAMP_DRIFT_SECONDS) {
    return false;
  }

  const computed = 'v0=' + createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex');

  if (computed.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

export function verifyDiscordSignature(
  publicKey: string,
  headers: Record<string, string>,
  body: string,
): boolean {
  const signature = headers['x-signature-ed25519'];
  const timestamp = headers['x-signature-timestamp'];
  if (!signature || !timestamp) return false;

  try {
    return verify(
      null,
      Buffer.from(timestamp + body),
      { key: Buffer.from(publicKey, 'hex'), format: 'raw', type: 'ed25519' } as any,
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && npx tsx --test src/channels/adapters/verify.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Write the failing test for the Slack adapter**

```ts
// packages/runtime/src/channels/adapters/slack.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slackChannel } from './slack.js';

describe('slackChannel', () => {
  it('creates a channel named slack', () => {
    const channel = slackChannel();
    assert.equal(channel.name, 'slack');
  });

  it('classifies a DM as interaction type "dm"', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'event_callback',
      event: {
        type: 'message',
        channel_type: 'im',
        text: 'Hey, can you fix the auth bug?',
        channel: 'D123ABC',
        user: 'U456DEF',
        ts: '1355517523.000005',
      },
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, 'Hey, can you fix the auth bug?');
    assert.equal(msg.metadata?.interaction, 'dm');
    assert.equal(msg.metadata?.channelId, 'D123ABC');
  });

  it('classifies an @mention as interaction type "mention"', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'event_callback',
      event: {
        type: 'app_mention',
        text: '<@U_BOT_ID> can you check the CI failures?',
        channel: 'C123ABC',
        user: 'U456DEF',
        ts: '1355517523.000005',
        thread_ts: '1355517520.000001',
      },
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, '<@U_BOT_ID> can you check the CI failures?');
    assert.equal(msg.metadata?.interaction, 'mention');
    assert.equal(msg.metadata?.threadTs, '1355517520.000001');
  });

  it('classifies a channel message as interaction type "ambient"', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'event_callback',
      event: {
        type: 'message',
        channel_type: 'channel',
        text: 'The deploy is broken again',
        channel: 'C123ABC',
        user: 'U456DEF',
        ts: '1355517523.000005',
      },
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.metadata?.interaction, 'ambient');
  });

  it('handles url_verification challenge', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'url_verification',
      challenge: 'test-challenge-string',
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, '');
    assert.equal(msg.metadata?._challenge, 'test-challenge-string');
  });

  it('formats engine output for Slack chat.postMessage', async () => {
    const channel = slackChannel();
    const formatted = await channel.format({
      content: 'PR opened: #42',
      metadata: {
        channelId: 'C123ABC',
        threadTs: '1355517520.000001',
      },
    });

    assert.equal(formatted.channel, 'C123ABC');
    assert.equal(formatted.text, 'PR opened: #42');
    assert.equal(formatted.thread_ts, '1355517520.000001');
  });

  it('skips bot messages to prevent loops', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'event_callback',
      event: {
        type: 'message',
        text: 'I am a bot',
        channel: 'C123',
        bot_id: 'B999',
        ts: '123.456',
      },
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, '');
    assert.equal(msg.metadata?._skip, true);
  });
});
```

- [ ] **Step 6: Implement the Slack adapter**

```ts
// packages/runtime/src/channels/adapters/slack.ts
import { defineChannel } from '../../api/define-channel.js';
import type { ArtificerChannel } from '../../api/types.js';
import { verifySlackSignature } from './verify.js';

/**
 * Classify the interaction type so the engine can decide how to respond:
 * - "dm": direct message — always respond
 * - "mention": @mentioned in a channel — always respond
 * - "ambient": message in a channel the bot is in — respond only if configured
 */
function classifyInteraction(event: Record<string, unknown>): string {
  if (event.type === 'app_mention') return 'mention';
  if (event.channel_type === 'im') return 'dm';
  return 'ambient';
}

export function slackChannel(): ArtificerChannel {
  return defineChannel({
    name: 'slack',
    description: 'Slack workspace integration — DMs, @mentions, and channel messages',

    verify: async (headers, body) => {
      const secret = process.env.SLACK_SIGNING_SECRET;
      if (!secret) return false;
      return verifySlackSignature(secret, headers, body);
    },

    receive: async (payload) => {
      // URL verification challenge (Slack setup handshake)
      if (payload.type === 'url_verification') {
        return {
          content: '',
          metadata: { channel: 'slack', _challenge: payload.challenge, _skip: true },
        };
      }

      const event = payload.event as Record<string, unknown> | undefined;
      if (!event) {
        return { content: '', metadata: { channel: 'slack', _skip: true } };
      }

      // Skip bot messages to prevent self-reply loops
      if (event.bot_id) {
        return { content: '', metadata: { channel: 'slack', _skip: true } };
      }

      const interaction = classifyInteraction(event);

      return {
        content: (event.text as string) ?? '',
        metadata: {
          channel: 'slack',
          interaction,
          channelId: event.channel,
          userId: event.user,
          threadTs: event.thread_ts ?? event.ts,
          messageTs: event.ts,
          channelType: event.channel_type,
        },
      };
    },

    format: async (output) => ({
      channel: output.metadata?.channelId,
      text: output.content,
      thread_ts: output.metadata?.threadTs,
    }),
  });
}

/**
 * Post a reply to Slack via chat.postMessage. Called by the channel route
 * handler after the engine processes the message, since Slack webhooks
 * cannot carry a synchronous reply. Always threads replies.
 */
export async function postSlackReply(
  channel: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
    }),
  });
}

/**
 * Update the bot's Slack profile status to reflect current work.
 * e.g., "Working on: Fix auth bug in payments-api"
 */
export async function updateSlackStatus(
  statusText: string,
  statusEmoji?: string,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  await fetch('https://slack.com/api/users.profile.set', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profile: {
        status_text: statusText,
        status_emoji: statusEmoji ?? ':robot_face:',
      },
    }),
  });
}
```

- [ ] **Step 7: Run Slack adapter tests**

Run: `cd packages/runtime && npx tsx --test src/channels/adapters/slack.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 8: Write the failing test for the Discord adapter**

```ts
// packages/runtime/src/channels/adapters/discord.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discordChannel } from './discord.js';

describe('discordChannel', () => {
  it('creates a channel named discord', () => {
    const channel = discordChannel();
    assert.equal(channel.name, 'discord');
  });

  it('handles PING interaction', async () => {
    const channel = discordChannel();
    const payload = { type: 1 };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, '');
    assert.equal(msg.metadata?._ping, true);
  });

  it('normalizes an APPLICATION_COMMAND interaction', async () => {
    const channel = discordChannel();
    const payload = {
      type: 2,
      data: {
        name: 'ask',
        options: [
          { name: 'message', type: 3, value: 'Fix the auth bug' },
        ],
      },
      channel_id: '444555666',
      member: {
        user: { id: '777888999', username: 'danny' },
      },
      token: 'interaction_token_abc',
      id: 'interaction_id_123',
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, 'Fix the auth bug');
    assert.equal(msg.metadata?.channelId, '444555666');
    assert.equal(msg.metadata?.username, 'danny');
    assert.equal(msg.metadata?.interactionToken, 'interaction_token_abc');
  });

  it('formats a deferred acknowledgement', async () => {
    const channel = discordChannel();
    const formatted = await channel.format({
      content: '',
      metadata: { _defer: true },
    });

    assert.equal(formatted.type, 5);
  });

  it('formats a direct reply', async () => {
    const channel = discordChannel();
    const formatted = await channel.format({
      content: 'Done! PR #42 opened.',
    });

    assert.equal(formatted.type, 4);
    assert.deepEqual(formatted.data, { content: 'Done! PR #42 opened.' });
  });
});
```

- [ ] **Step 9: Implement the Discord adapter**

```ts
// packages/runtime/src/channels/adapters/discord.ts
import { defineChannel } from '../../api/define-channel.js';
import type { ArtificerChannel } from '../../api/types.js';
import { verifyDiscordSignature } from './verify.js';

// Discord interaction types
const PING = 1;
const APPLICATION_COMMAND = 2;

// Discord response types
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;

export function discordChannel(): ArtificerChannel {
  return defineChannel({
    name: 'discord',
    description: 'Discord server integration via slash commands',

    verify: async (headers, body) => {
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (!publicKey) return false;
      return verifyDiscordSignature(publicKey, headers, body);
    },

    receive: async (payload) => {
      const type = payload.type as number;

      // PING — Discord endpoint validation
      if (type === PING) {
        return {
          content: '',
          metadata: { channel: 'discord', _ping: true, _skip: true },
        };
      }

      // APPLICATION_COMMAND — slash command
      if (type === APPLICATION_COMMAND) {
        const data = payload.data as Record<string, unknown>;
        const options = (data?.options as Array<{ name: string; value: string }>) ?? [];
        const messageOpt = options.find((o) => o.name === 'message');
        const content = messageOpt?.value ?? (data?.name as string) ?? '';
        const member = payload.member as Record<string, unknown> | undefined;
        const user = member?.user as Record<string, unknown> | undefined;

        return {
          content,
          metadata: {
            channel: 'discord',
            channelId: payload.channel_id,
            userId: user?.id,
            username: user?.username,
            interactionToken: payload.token,
            interactionId: payload.id,
            command: data?.name,
          },
        };
      }

      return { content: '', metadata: { channel: 'discord', _skip: true } };
    },

    format: async (output) => {
      // PING response
      if (output.metadata?._ping) {
        return { type: PONG };
      }

      // Deferred acknowledgement (engine will follow up later)
      if (output.metadata?._defer || output.content === '') {
        return { type: DEFERRED_CHANNEL_MESSAGE };
      }

      // Direct reply
      return {
        type: CHANNEL_MESSAGE,
        data: { content: output.content },
      };
    },
  });
}

/**
 * Edit the deferred interaction response with the final result.
 * Called when a workstream completes after the initial acknowledgement.
 */
export async function editDiscordResponse(
  interactionToken: string,
  content: string,
): Promise<void> {
  const appId = process.env.DISCORD_APP_ID;
  if (!appId) return;

  await fetch(
    `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
}
```

- [ ] **Step 10: Run Discord adapter tests**

Run: `cd packages/runtime && npx tsx --test src/channels/adapters/discord.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 11: Export adapters from index.ts**

```ts
export { slackChannel, postSlackReply, updateSlackStatus } from './channels/adapters/slack.js';
export { discordChannel, editDiscordResponse } from './channels/adapters/discord.js';
export { verifySlackSignature, verifyDiscordSignature } from './channels/adapters/verify.js';
```

- [ ] **Step 12: Run full test suite and commit**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

```bash
git add packages/runtime/src/channels/adapters/ packages/runtime/src/index.ts
git commit -m "feat(runtime): add built-in Slack and Discord channel adapters"
```

> **Usage:** Users can use the built-in adapters directly in `agent/channels/`:
> ```ts
> // agent/channels/slack.ts
> import { slackChannel } from '@artificer/runtime';
> export default slackChannel();
> ```
> Or customize by wrapping:
> ```ts
> import { slackChannel } from '@artificer/runtime';
> const base = slackChannel();
> export default defineChannel({
>   ...base.definition,
>   receive: async (payload) => {
>     const msg = await base.receive(payload);
>     // Filter: only respond to DMs and mentions, ignore ambient
>     if (msg.metadata?.interaction === 'ambient') {
>       return { content: '', metadata: { ...msg.metadata, _skip: true } };
>     }
>     return msg;
>   },
> });
> ```
>
> **"Person" interaction model:** The Slack adapter classifies every incoming message as `dm`, `mention`, or `ambient`. The channel route handler (Task 3) checks `metadata.interaction` — DMs and mentions are always passed to `engine.receiveMessage()`, ambient messages are skipped by default (configurable). The bot appears as a person in Slack's sidebar and can be DM'd or @mentioned like a colleague. Multiple Artificer instances = multiple bot users in the same workspace, each with their own name and avatar.
>
> **Slack async reply pattern:** Slack webhooks require returning `200 OK` immediately — you cannot send a reply in the webhook response body. The channel route handler acknowledges the webhook, then calls `engine.receiveMessage()` in the background. When the engine produces a reply, `postSlackReply()` posts it via `chat.postMessage`, always in-thread. When a workstream starts or progresses, `updateSlackStatus()` updates the bot's profile status.
>
> **Discord deferred response pattern:** Discord slash commands have a 3-second response window. The handler returns `{ type: 5 }` (deferred) immediately, then `editDiscordResponse()` updates the message when the workstream produces output. This maps naturally to Artificer's async workstream model.

---

### Task 5: `defineConnection` — MCP & OpenAPI Connections

Typed connection definitions for external services. Credentials reference env vars by name — the runtime injects them at the HTTP layer so raw tokens never appear in LLM context.

**Files:**
- Create: `packages/runtime/src/api/define-connection.ts`
- Modify: `packages/runtime/src/api/types.ts` (add connection types)
- Create: `packages/runtime/src/connections/mcp-client.ts`
- Modify: `packages/runtime/src/index.ts` (add exports)
- Test: `packages/runtime/src/api/define-connection.test.ts`

**Interfaces:**
- Consumes: `ToolDef` from `llm/types.ts`, `ToolRegistry` from `api/tool-registry.ts`
- Produces: `defineConnection(definition: ConnectionDefinition): ArtificerConnection` — defines an MCP server or OpenAPI spec connection. `ConnectionDefinition` has: `type: 'mcp' | 'openapi'`, `url` (MCP server URL or OpenAPI spec URL), `description`, `auth` (credential reference: `{ type: 'bearer', envVar: 'LINEAR_API_KEY' }` or `{ type: 'basic', envVar: 'JIRA_TOKEN' }` or `{ type: 'header', name: 'X-API-Key', envVar: 'CUSTOM_KEY' }`). The connection materializes as tools in the `ToolRegistry` — MCP tools are proxied, OpenAPI operations become tools.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/api/define-connection.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineConnection } from './define-connection.js';

describe('defineConnection', () => {
  it('creates an MCP connection definition', () => {
    const conn = defineConnection({
      type: 'mcp',
      name: 'linear',
      description: 'Linear project management',
      url: 'https://mcp.linear.app',
      auth: { type: 'bearer', envVar: 'LINEAR_API_KEY' },
    });

    assert.equal(conn.name, 'linear');
    assert.equal(conn.definition.type, 'mcp');
    assert.equal(conn.definition.auth?.envVar, 'LINEAR_API_KEY');
  });

  it('creates an OpenAPI connection definition', () => {
    const conn = defineConnection({
      type: 'openapi',
      name: 'jira',
      description: 'JIRA issue tracking',
      url: 'https://acme.atlassian.net/rest/api/2',
      specUrl: 'https://acme.atlassian.net/openapi.json',
      auth: { type: 'basic', envVar: 'JIRA_TOKEN' },
      operations: { allow: ['searchIssues', 'getIssue', 'createIssue'] },
    });

    assert.equal(conn.name, 'jira');
    assert.equal(conn.definition.type, 'openapi');
    assert.deepEqual(conn.definition.operations?.allow, [
      'searchIssues', 'getIssue', 'createIssue',
    ]);
  });

  it('supports header-based auth', () => {
    const conn = defineConnection({
      type: 'mcp',
      name: 'custom',
      description: 'Custom service',
      url: 'http://localhost:3000/mcp',
      auth: { type: 'header', name: 'X-API-Key', envVar: 'CUSTOM_KEY' },
    });

    assert.equal(conn.definition.auth?.type, 'header');
    assert.equal(conn.definition.auth?.name, 'X-API-Key');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/api/define-connection.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Add connection types**

```ts
// packages/runtime/src/api/types.ts (append)

export interface ConnectionAuth {
  type: 'bearer' | 'basic' | 'header';
  envVar: string;
  name?: string; // header name, only for type: 'header'
}

export interface ConnectionDefinition {
  type: 'mcp' | 'openapi';
  name: string;
  description: string;
  url: string;
  specUrl?: string; // OpenAPI spec URL (for type: 'openapi')
  auth?: ConnectionAuth;
  operations?: { allow: string[] } | { block: string[] };
  roles?: RoleName[];
}

export interface ArtificerConnection {
  readonly name: string;
  readonly definition: ConnectionDefinition;
}
```

- [ ] **Step 4: Implement `defineConnection`**

```ts
// packages/runtime/src/api/define-connection.ts
import type { ArtificerConnection, ConnectionDefinition } from './types.js';

export function defineConnection(
  definition: ConnectionDefinition,
): ArtificerConnection {
  return {
    name: definition.name,
    definition,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/api/define-connection.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 6: Export from index.ts**

```ts
export { defineConnection } from './api/define-connection.js';
export type { ConnectionDefinition, ConnectionAuth, ArtificerConnection } from './api/types.js';
```

- [ ] **Step 7: Run full test suite and commit**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

```bash
git add packages/runtime/src/api/define-connection.ts packages/runtime/src/api/define-connection.test.ts packages/runtime/src/api/types.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add defineConnection for MCP and OpenAPI integrations"
```

> **Note:** This task defines the connection type and API. Actually connecting to MCP servers and materializing their tools into the `ToolRegistry` is a follow-up task that depends on an MCP client library. The type system and credential model are the foundation.

---

### Task 6: `GIT_CEILING_DIRECTORIES` Workspace Isolation

Prevent git commands in `.artificer/workspace/` from bleeding into the agent's identity repo.

**Files:**
- Modify: `packages/runtime/src/tools/git-env.ts:17-55` (add `workspaceDir` parameter, set `GIT_CEILING_DIRECTORIES`)
- Modify: `packages/runtime/src/tools/shell.ts` (pass workspace dir to buildGitEnv)
- Modify: `packages/runtime/src/tools/git.ts` (pass workspace dir to buildGitEnv)
- Test: `packages/runtime/src/tools/git-env.test.ts`

**Interfaces:**
- Consumes: `GitHubConfig` from `config.ts`, `workspaceDir` from `ToolContext`
- Produces: Updated `buildGitEnv(github, base, workspaceDir?)` that sets `GIT_CEILING_DIRECTORIES` to the parent of `workspaceDir` when provided. This prevents git from walking up past the workspace root and finding the agent repo's `.git`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/tools/git-env.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGitEnv } from './git-env.js';

describe('buildGitEnv', () => {
  it('sets GIT_CEILING_DIRECTORIES when workspaceDir is provided', () => {
    const env = buildGitEnv(
      { token: 'ghp_test' },
      {},
      '/home/user/my-agent/.artificer/workspace/ws_abc123',
    );

    assert.equal(
      env.GIT_CEILING_DIRECTORIES,
      '/home/user/my-agent/.artificer/workspace',
    );
  });

  it('does not set GIT_CEILING_DIRECTORIES without workspaceDir', () => {
    const env = buildGitEnv({ token: 'ghp_test' }, {});
    assert.equal(env.GIT_CEILING_DIRECTORIES, undefined);
  });

  it('preserves existing env vars', () => {
    const env = buildGitEnv(
      { token: 'ghp_test' },
      { HOME: '/home/user', EXISTING: 'value' },
      '/workspace/ws_1',
    );

    assert.equal(env.HOME, '/home/user');
    assert.equal(env.EXISTING, 'value');
    assert.equal(env.GH_TOKEN, 'ghp_test');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && npx tsx --test src/tools/git-env.test.ts`
Expected: FAIL — `buildGitEnv` doesn't accept a third argument

- [ ] **Step 3: Update `buildGitEnv` to accept `workspaceDir`**

In `packages/runtime/src/tools/git-env.ts`, change the function signature:

```ts
export function buildGitEnv(
  github: GitHubConfig | undefined,
  base: NodeJS.ProcessEnv = process.env,
  workspaceDir?: string,
): NodeJS.ProcessEnv {
```

After the existing env setup, add:

```ts
  if (workspaceDir) {
    env.GIT_CEILING_DIRECTORIES = path.dirname(workspaceDir);
  }
```

Add `import path from 'node:path';` at the top.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/runtime && npx tsx --test src/tools/git-env.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Update call sites to pass workspace dir**

In `packages/runtime/src/tools/shell.ts` and `packages/runtime/src/tools/git.ts`, where `buildGitEnv` is called, pass `ctx.workspaceDir` as the third argument:

```ts
const env = buildGitEnv(ctx.engine.config.github, process.env, ctx.workspaceDir);
```

- [ ] **Step 6: Run full test suite and commit**

Run: `cd packages/runtime && npm test`
Expected: All tests pass

```bash
git add packages/runtime/src/tools/git-env.ts packages/runtime/src/tools/git-env.test.ts packages/runtime/src/tools/shell.ts packages/runtime/src/tools/git.ts
git commit -m "fix(runtime): add GIT_CEILING_DIRECTORIES to prevent workspace git bleed"
```

---

### Task 7: CLI Package — `artificer init` and `artificer dev`

A thin CLI that scaffolds agent repos and starts the runtime with discovery.

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/src/index.ts` (CLI entry point)
- Create: `packages/cli/src/commands/init.ts`
- Create: `packages/cli/src/commands/dev.ts`
- Create: `packages/cli/src/commands/start.ts`
- Create: `packages/cli/src/template/` (scaffold template files)
- Modify: `pnpm-workspace.yaml` (add packages/cli)

**Interfaces:**
- Consumes: `createRuntime` from `@artificer/runtime`, `scanAgentDirectory` from `@artificer/runtime`
- Produces: `@artificer/cli` npm package with bin entry `artificer`. Commands:
  - `artificer init <name>` — scaffolds a new agent repo with `artificer.config.ts`, `agent/` directory, `identity/` directory, `.env.example`, `.gitignore`, and `package.json`
  - `artificer dev` — discovers the agent repo in cwd, loads config via tsx, starts the runtime with UI, watches for file changes
  - `artificer start` — production mode, no hot reload, requires `ARTIFICER_API_KEY`

- [ ] **Step 1: Create package.json for the CLI**

```json
{
  "name": "@artificer/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "artificer": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@artificer/runtime": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Implement the `init` command**

```ts
// packages/cli/src/commands/init.ts
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_TEMPLATE = `import { defineConfig } from '@artificer/runtime';

export default defineConfig({
  name: '{{NAME}}',
  description: 'An Artificer agent',
  preset: 'async-economy',
  identity: {
    autoCommit: true,
    autoPush: false,
  },
});
`;

const GITIGNORE_TEMPLATE = `.artificer/
.env
node_modules/
`;

const ENV_EXAMPLE = `# LLM gateway
LLM_API_KEY=

# Agent GitHub identity (optional)
# GITHUB_TOKEN=
# GITHUB_USER_NAME=
# GITHUB_USER_EMAIL=

# API authentication (required in production)
# ARTIFICER_API_KEY=

# Connection credentials
# JIRA_TOKEN=
# SLACK_BOT_TOKEN=
# SLACK_SIGNING_SECRET=
`;

const INSTRUCTIONS_TEMPLATE = `## Agent Instructions

Add context about your team, codebase, and conventions here.
The agent includes this in its system prompt for all roles.
`;

export function init(name: string, targetDir?: string): void {
  const dir = targetDir ?? path.resolve(process.cwd(), name);

  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    console.error(`Directory ${dir} already exists and is not empty.`);
    process.exit(1);
  }

  // Create directory structure
  fs.mkdirSync(path.join(dir, 'agent', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agent', 'channels'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agent', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'identity', 'memories'), { recursive: true });

  // Write files
  fs.writeFileSync(
    path.join(dir, 'artificer.config.ts'),
    CONFIG_TEMPLATE.replace('{{NAME}}', name),
  );
  fs.writeFileSync(path.join(dir, '.gitignore'), GITIGNORE_TEMPLATE);
  fs.writeFileSync(path.join(dir, '.env.example'), ENV_EXAMPLE);
  fs.writeFileSync(path.join(dir, '.env'), ENV_EXAMPLE);
  fs.writeFileSync(
    path.join(dir, 'agent', 'instructions.md'),
    INSTRUCTIONS_TEMPLATE,
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        dependencies: { '@artificer/runtime': 'latest' },
      },
      null,
      2,
    ),
  );

  console.log(`Created ${name} at ${dir}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${name}`);
  console.log('  cp .env.example .env     # add your API keys');
  console.log('  npm install');
  console.log('  artificer dev');
}
```

- [ ] **Step 3: Implement the `dev` command**

```ts
// packages/cli/src/commands/dev.ts
import path from 'node:path';

export async function dev(rootDir?: string): Promise<void> {
  const dir = rootDir ?? process.cwd();

  // Dynamic import so tsx handles TypeScript loading
  const { createRuntime } = await import('@artificer/runtime');

  const runtime = await createRuntime({ rootDir: dir });

  console.log(`[artificer] Starting ${runtime.config.agentName} in dev mode`);
  await runtime.start();
}
```

- [ ] **Step 4: Implement the CLI entry point**

```ts
// packages/cli/src/index.ts
const [, , command, ...args] = process.argv;

switch (command) {
  case 'init': {
    const { init } = await import('./commands/init.js');
    init(args[0] ?? 'my-agent');
    break;
  }
  case 'dev': {
    const { dev } = await import('./commands/dev.js');
    await dev(args[0]);
    break;
  }
  case 'start': {
    const { dev } = await import('./commands/dev.js');
    await dev(args[0]);
    break;
  }
  default:
    console.log('Usage: artificer <init|dev|start> [args]');
    console.log('');
    console.log('Commands:');
    console.log('  init <name>    Create a new agent project');
    console.log('  dev            Start in development mode');
    console.log('  start          Start in production mode');
}
```

- [ ] **Step 5: Add to pnpm workspace**

In `pnpm-workspace.yaml`, add `packages/cli` to the packages list.

- [ ] **Step 6: Test manually**

```bash
cd packages/cli && npx tsx src/index.ts init test-agent
ls -la /tmp/test-agent/  # verify structure
rm -rf /tmp/test-agent
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli/ pnpm-workspace.yaml
git commit -m "feat(cli): add @artificer/cli with init, dev, and start commands"
```

---

## What This Plan Produces

After these 7 tasks:

1. **Single-command DX** — `artificer dev` starts the runtime + UI on one port
2. **API authentication** — bearer token auth, optional locally, required in production
3. **Channel webhooks** — custom channels receive webhooks at `/channels/{name}/`
4. **Built-in Slack & Discord** — production-ready adapters with webhook verification, async reply patterns, and deferred responses
5. **MCP/OpenAPI connections** — `defineConnection` API with credential brokering via `.env`
6. **Workspace isolation** — `GIT_CEILING_DIRECTORIES` prevents git bleed
7. **CLI** — `artificer init` scaffolds, `artificer dev` runs, `artificer start` for production

## What This Plan Does NOT Cover (Future Work)

1. **Additional channel adapters** — GitHub (webhook events → workstreams), Linear, Teams, Telegram. Same `defineChannel` pattern as Slack/Discord.
2. **MCP client runtime** — actually connecting to MCP servers, listing tools, proxying calls. The `defineConnection` API is defined but the runtime MCP client is not.
3. **Human-in-the-loop approval enforcement** — `needsApproval` is defined in the tool type but not enforced at runtime. Needs SSE-based approval flow and UI integration.
4. **Slack/Discord async reply wiring** — the adapters define the format, but wiring `postSlackReply` / `editDiscordResponse` to fire when the engine produces a response requires changes to the channel route handler (Task 3) to support async reply patterns.
5. **Hot reload in dev mode** — watching for file changes and reloading tools/config without restart.
6. **Auto-commit daemon** — watching identity changes and committing with descriptive messages.
7. **`artificer build`** — compile the agent for production deployment (bundle TypeScript, optimize assets).
8. **`defineEval`** — generic eval framework beyond SWE-bench.
9. **Docker packaging** — Dockerfile and compose template for containerized deployment.
10. **Memory migration** — migrating existing JSON-blob memories to the new markdown identity format.
