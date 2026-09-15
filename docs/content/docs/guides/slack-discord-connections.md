---
title: Connect Slack & Discord
description: This guide shows how to connect an Artificer agent to Slack and Discord so your team can message it like a colleague — via Slack DMs and `@mentions`, or Discord slash commands.
---

# Connect Slack & Discord

This guide shows how to connect an Artificer agent to Slack and Discord so your team can message it like a colleague — via Slack DMs and `@mentions`, or Discord slash commands.

| Channel | How people talk to the agent | Webhook URL |
|---------|------------------------------|-------------|
| Slack | DM the bot, or `@mention` it in a channel | `https://your-host/channels/slack` |
| Discord | `/ask message:your request` (slash command) | `https://your-host/channels/discord` |

Slack and Discord verify webhooks with their own secrets. Those routes do not use your Artificer API key.

---

## Before you start

You will need:

- **Node.js 21+**
- **The Artificer CLI** installed globally:
  ```bash
  npm install -g @artificer-ai/cli
  ```
- **An agent project** — if you do not have one yet, follow [Setting Up an Agent Identity Repo](/docs/guides/agent-identity-setup) (`artificer init my-agent`).
- **An LLM API key** in your agent's `.env` (`LLM_API_KEY=...`) so the agent can actually respond.
- **A public HTTPS URL** that reaches your running agent. Slack and Discord cannot send webhooks to `localhost`.

For local development, use a tunnel (ngrok, Cloudflare Tunnel, etc.). For production, deploy the agent to a server with a stable HTTPS domain.

---

## Overview

The setup has three parts:

1. **Configure your agent** — add channel files, credentials, and start the runtime.
2. **Expose the runtime** — give Slack/Discord a URL they can reach.
3. **Create apps in Slack and/or Discord** — point their webhooks at your agent.

You can set up one channel or both. The steps are independent.

---

## 1. Configure your agent

All commands below run from your agent project directory (the folder created by `artificer init`).

### Install dependencies

If you have not already:

```bash
npm install
```

### Enable Slack and/or Discord

Create one file per channel inside `agent/channels/`:

**`agent/channels/slack.ts`**

```ts
import { slackChannel } from '@artificer-ai/runtime';

export default slackChannel();
```

**`agent/channels/discord.ts`**

```ts
import { discordChannel } from '@artificer-ai/runtime';

export default discordChannel();
```

These files are loaded automatically when you start the agent. You only need the files for the channels you plan to use.

**Optional:** By default, Slack responds to DMs and `@mentions`. To ignore general channel chatter (messages that do not `@mention` the bot), replace the Slack file with:

```ts
import { defineChannel, slackChannel } from '@artificer-ai/runtime';

const base = slackChannel();

export default defineChannel({
  ...base.definition,
  receive: async (payload) => {
    const msg = await base.receive(payload);
    if (msg.metadata?.interaction === 'ambient') {
      return { content: '', metadata: { ...msg.metadata, _skip: true } };
    }
    return msg;
  },
});
```

### Add credentials to `.env`

Add the variables for each channel you are setting up:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Discord
DISCORD_PUBLIC_KEY=...
DISCORD_APP_ID=...
DISCORD_BOT_TOKEN=...
```

See [Environment variables](#environment-variables) below for where to find each value.

### Start the agent

```bash
artificer dev
```

You should see output like:

```
[artificer] Atlas ready

  API   http://localhost:4100/api
  UI    http://localhost:4100
  SSE   http://localhost:4100/events

  identity  /Users/you/atlas
  exec      /Users/you/.artificer/Atlas
  channels  slack, discord
```

The `channels` line confirms your adapters loaded. If a channel is missing from that list, check that the file exists under `agent/channels/` and that `npm install` completed successfully.

The runtime listens on port **4100** by default. Override with `PORT=8080` in `.env` if needed.

---

## 2. Expose your agent to the internet

Slack and Discord need to POST webhooks to your agent. During local development, run a tunnel alongside `artificer dev`:

```bash
ngrok http 4100
```

Copy the HTTPS URL ngrok gives you (e.g. `https://abc123.ngrok-free.app`). Your webhook endpoints will be:

- **Slack:** `https://abc123.ngrok-free.app/channels/slack`
- **Discord:** `https://abc123.ngrok-free.app/channels/discord`

Keep both the tunnel and `artificer dev` running while you configure and test.

**Production:** Deploy your agent behind HTTPS on a stable domain (e.g. `https://atlas.yourcompany.com`) and use that host in place of the ngrok URL. Run the agent with `artificer start` and set `ARTIFICER_API_KEY` in production.

---

## 3. Set up Slack

All steps are in the [Slack API dashboard](https://api.slack.com/apps).

### Create the app

1. Go to **Your Apps → Create New App → From scratch**.
2. Name the app after your agent (e.g. "Atlas") and select your workspace.
3. Open **Settings → Basic Information** and copy the **Signing Secret** into `SLACK_SIGNING_SECRET` in your `.env`.

### Give the bot a personality

Under **Features → App Home**:

1. Set the bot display name and avatar to match your agent's identity.
2. Enable the **Messages Tab** if you want a clean DM experience in the sidebar.

### Add permissions

Under **Features → OAuth & Permissions → Bot Token Scopes**, add:

| Scope | Why |
|-------|-----|
| `chat:write` | Send replies |
| `im:history` | Read DM history |
| `im:read` | Access DM channels |
| `app_mentions:read` | Receive `@mention` events |
| `channels:history` | Only if you want the bot to see all channel messages |
| `users.profile:write` | Optional — update the bot's status line |

### Install to your workspace

1. On the same **OAuth & Permissions** page, click **Install to Workspace** and approve.
2. Copy the **Bot User OAuth Token** (`xoxb-...`) into `SLACK_BOT_TOKEN` in your `.env`.
3. Restart `artificer dev` so it picks up the new env vars.

### Enable events

Under **Features → Event Subscriptions**:

1. Turn **Enable Events** on.
2. Set **Request URL** to your public URL + `/channels/slack`:
   ```
   https://abc123.ngrok-free.app/channels/slack
   ```
3. Slack sends a verification challenge. If setup is correct, the URL shows a green checkmark.
4. Under **Subscribe to bot events**, add:
   - `message.im` — direct messages
   - `app_mention` — `@Atlas`-style mentions
   - `message.channels` — optional; all messages in channels the bot is in
5. Save changes.

### Invite the bot to a channel

For `@mention` testing, invite the bot to a channel:

```
/invite @Atlas
```

### Test Slack

| What to try | What success looks like |
|-------------|-------------------------|
| URL verification | Green checkmark on the Request URL |
| Direct message | Send "hello" in a DM with the bot |
| @mention | `@Atlas what can you help with?` in a channel |
| Agent terminal | `[artificer] → message received` appears in the `artificer dev` output |

You can also open the agent UI at `http://localhost:4100` to see incoming messages and workstreams.

---

## 4. Set up Discord

All steps are in the [Discord Developer Portal](https://discord.com/developers/applications).

### Create the application

1. Click **New Application** and name it after your agent.
2. Under **General Information**, copy:
   - **Application ID** → `DISCORD_APP_ID`
   - **Public Key** → `DISCORD_PUBLIC_KEY`

Add both to your `.env` and restart `artificer dev`.

### Create a bot

1. Open **Bot** in the sidebar → **Add Bot**.
2. Under **Token**, reset and copy the token → `DISCORD_BOT_TOKEN`.
3. **Message Content Intent** is not required for slash commands.

### Register a slash command

The built-in adapter looks for a slash command with a required string option named **`message`**. The command name can be anything; `ask` is a good default.

Register it with the Discord API (replace `YOUR_APP_ID` and `YOUR_BOT_TOKEN`):

```bash
curl -X POST \
  "https://discord.com/api/v10/applications/YOUR_APP_ID/commands" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ask",
    "description": "Send a message to the agent",
    "options": [
      {
        "name": "message",
        "description": "What should the agent do?",
        "type": 3,
        "required": true
      }
    ]
  }'
```

**Tip:** Global commands can take up to an hour to appear. For faster testing, register a guild-specific command by adding `/guilds/YOUR_GUILD_ID/` to the URL path. Guild commands show up immediately.

### Set the Interactions Endpoint URL

1. Go back to **General Information**.
2. Set **Interactions Endpoint URL** to your public URL + `/channels/discord`:
   ```
   https://abc123.ngrok-free.app/channels/discord
   ```
3. Discord sends a ping to verify the endpoint. If verification succeeds, the URL saves without error.

### Invite the bot to your server

Under **OAuth2 → URL Generator**:

1. Scopes: `bot`, `applications.commands`
2. Bot permissions: **Send Messages**, **Use Slash Commands**, **Read Message History**
3. Open the generated URL in a browser and add the bot to your server.

### Test Discord

| What to try | What success looks like |
|-------------|-------------------------|
| Endpoint verification | Interactions URL saves successfully |
| Slash command | Type `/ask message:hello` in a channel |
| Agent terminal | `[artificer] → message received` in the `artificer dev` output |

---

## 5. Verify everything works

Use this checklist before calling the integration done:

- [ ] `artificer dev` is running and lists your channels on startup
- [ ] Your tunnel (or production host) forwards HTTPS traffic to the agent port
- [ ] `.env` has credentials for each channel you enabled
- [ ] Slack Request URL shows a green checkmark (if using Slack)
- [ ] Discord Interactions Endpoint URL saved successfully (if using Discord)
- [ ] Sending a test message produces `[artificer] → message received` in the terminal
- [ ] The agent UI at `http://localhost:4100` shows the message and any workstream activity

---

## Troubleshooting

### Slack Request URL verification fails

- Confirm `artificer dev` is running and `slack` appears in the startup `channels` line.
- Confirm your tunnel is running and points at the same port as the agent (default 4100).
- Confirm `SLACK_SIGNING_SECRET` matches **Basic Information → Signing Secret** in the Slack app settings.
- Restart `artificer dev` after changing `.env`.
- If you restart ngrok, the URL changes — update the Request URL in Slack.

### Slack events arrive but the bot does not reply

- Confirm `SLACK_BOT_TOKEN` is set and the app is installed to the workspace.
- Confirm the bot has the `chat:write` scope.
- Check the terminal for LLM errors (usually a missing or invalid `LLM_API_KEY`).
- Open `http://localhost:4100` — the agent may be processing even if the Slack reply is delayed.

### Discord endpoint verification fails

- Confirm `DISCORD_PUBLIC_KEY` is the **Public Key** from the Developer Portal — not the bot token.
- Confirm `discord` appears in the startup `channels` line.
- Confirm `agent/channels/discord.ts` exists and restart `artificer dev`.

### Discord slash command does not appear

- Global commands can take up to an hour. Use a guild-specific command for immediate testing.
- Confirm the bot was invited with the `applications.commands` scope.
- Re-run the command registration curl and check for a `200` or `201` response.

### `401 Verification failed` on incoming webhooks

- Double-check env var names: `SLACK_SIGNING_SECRET`, `DISCORD_PUBLIC_KEY`.
- Restart `artificer dev` after editing `.env`.
- Make sure your tunnel or reverse proxy is not modifying request bodies.

### The agent receives messages but gives poor or empty responses

- Set a valid `LLM_API_KEY` in `.env`.
- Check workstreams in the UI at `http://localhost:4100`.
- Run with verbose logging: `ARTIFICER_VERBOSE=true artificer dev`.

---

## What to expect

A few behaviors are worth knowing about while the integration matures:

- **Slack replies may lag.** Slack expects an instant acknowledgment; the agent processes work asynchronously. You may see activity in the terminal or UI before a reply appears in Slack.
- **Discord slash commands work the same way.** Long-running tasks may not show a final Discord message immediately.
- **Ambient Slack messages** are off by default unless you subscribe to `message.channels` *and* do not use the optional filter above. Most teams only want DMs and `@mentions`.

---

## Environment variables

| Variable | Required for | Where to get it |
|----------|--------------|-----------------|
| `SLACK_SIGNING_SECRET` | Slack | Slack app → Basic Information → Signing Secret |
| `SLACK_BOT_TOKEN` | Slack replies | Slack app → OAuth & Permissions → Bot User OAuth Token |
| `DISCORD_PUBLIC_KEY` | Discord | Developer Portal → General Information → Public Key |
| `DISCORD_APP_ID` | Discord replies | Developer Portal → General Information → Application ID |
| `DISCORD_BOT_TOKEN` | Discord command registration | Developer Portal → Bot → Token |
| `LLM_API_KEY` | Agent responses | Your LLM provider (OpenCode Zen, Anthropic, etc.) |
| `PORT` | Local port | Default `4100` |
| `ARTIFICER_API_KEY` | Production API auth | Generate with `openssl rand -hex 32` |

---

## Related docs

- [Setting Up an Agent Identity Repo](/docs/guides/agent-identity-setup) — create and configure your agent project
