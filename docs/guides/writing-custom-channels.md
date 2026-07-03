# Writing Custom Channels

Channels are how messages get into the agent. The built-in Slack and Discord adapters cover the most common cases, but you can add any channel — a webhook from a GitHub Action, an SMS gateway, a custom HTTP endpoint — using `defineChannel()` from `@artificer-ai/runtime`.

## Where channel files go

```
my-agent/
└── agent/
    └── channels/
        ├── slack.ts     ← built-in adapter
        └── webhook.ts   ← your custom channel
```

The runtime loads all `.ts` files in `agent/channels/` at startup. The startup banner lists active channels — verify yours appears there.

## The `defineChannel()` API

```ts
import { defineChannel } from '@artificer-ai/runtime';

export default defineChannel({
  name: 'webhook',
  description: 'Generic inbound webhook',

  // optional — validate the request before processing
  verify: async (headers, body) => {
    // return true to allow, false to reject with 401
    return true;
  },

  // parse the raw JSON payload into a ChannelMessage
  receive: async (payload) => {
    return {
      content: payload.message as string,
      metadata: { channel: 'webhook' },
    };
  },

  // shape the reply that goes back to the caller as the HTTP response body
  format: async (output) => ({
    ok: true,
    reply: output.content,
  }),
});
```

The runtime mounts this channel at `POST /channels/webhook`. When a request arrives, the runtime:

1. Calls `verify()` (if defined) — returns 401 if it fails
2. Calls `receive()` to parse the payload into a `ChannelMessage`
3. Passes the message to the agent engine and waits for a response
4. Calls `format()` to shape the response, then returns it as the JSON body

Each field:

- **`name`** — sets the route path. A channel named `webhook` is mounted at `/channels/webhook`.
- **`description`** — shown in the startup banner and used for logging.
- **`verify`** — optional. Receives the raw request headers and raw body string. Return `true` to allow the request; `false` to reject it — the runtime responds with `401 { "error": "Verification failed" }`.
- **`receive`** — receives the parsed JSON payload as `Record<string, unknown>`. Must return a `ChannelMessage` with at least a `content` string. Pass additional context in `metadata`.
- **`format`** — receives a `ChannelOutput` containing the agent's reply and the original metadata. Return any `Record<string, unknown>` — this becomes the HTTP response body.

### Full example: simple webhook channel

```ts
// agent/channels/webhook.ts
import { defineChannel } from '@artificer-ai/runtime';

export default defineChannel({
  name: 'webhook',
  description: 'Generic JSON webhook',

  receive: async (payload) => {
    const message = payload.message;
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('Missing required field: message');
    }
    return {
      content: message,
      metadata: { channel: 'webhook' },
    };
  },

  format: async (output) => ({
    ok: true,
    reply: output.content,
  }),
});
```

## Webhook verification

Slack and Discord verify webhook authenticity via HMAC signatures. If your channel source (GitHub, PagerDuty, or similar) also signs requests, verify the signature in the `verify` handler before the payload reaches `receive`.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { defineChannel } from '@artificer-ai/runtime';

export default defineChannel({
  name: 'pagerduty',
  description: 'PagerDuty webhook integration',

  verify: async (headers, body) => {
    const secret = process.env.PAGERDUTY_WEBHOOK_SECRET;
    if (!secret) return false;

    const signature = headers['x-pagerduty-signature'];
    if (!signature) return false;

    const expected = createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Use timingSafeEqual to avoid timing attacks
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  },

  receive: async (payload) => ({
    content: JSON.stringify(payload),
    metadata: { channel: 'pagerduty' },
  }),

  format: async (output) => ({
    ok: true,
  }),
});
```

If your channel source does not sign requests, omit `verify`. Unauthenticated endpoints should only be exposed behind network controls (VPN, internal network, IP allowlist).

## Adding the channel to `.env`

Any channel-specific config — signing secrets, API keys — goes in `.env` and is accessed via `process.env.*`:

```bash
# .env
PAGERDUTY_WEBHOOK_SECRET=your_signing_secret_here
```

The `.env` file is gitignored. Never commit secrets.

## Test the channel

With the agent running (`artificer dev`), send a test request with curl:

```bash
curl -X POST http://localhost:4100/channels/webhook \
  -H 'content-type: application/json' \
  -d '{"message": "Deploy the staging environment"}'
```

You should get back a JSON response containing the agent's reply:

```json
{ "ok": true, "reply": "Deploying staging environment now..." }
```

The agent UI at `http://localhost:4100` shows the incoming message and any workstream activity.

## Related docs

- [Slack & Discord connections](./slack-discord-connections.md) — built-in channel adapters
- [Core concepts — channels](../getting-started/core-concepts.md#channels)
