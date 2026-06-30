# Deploying to Fly.io

This guide covers deploying an Artificer agent instance to [Fly.io](https://fly.io) — a good choice for personal or small-team self-hosting. You get always-on compute, a persistent volume for agent data, and HTTPS out of the box for around $3–5/month.

The guide assumes you have an agent project created with `artificer init`. If not, run:

```bash
npm install -g @artificer-ai/cli
artificer init my-agent
cd my-agent
```

## Prerequisites

- [flyctl](https://fly.io/docs/flyctl/install/) installed (`brew install flyctl` on macOS)
- A [Fly.io account](https://fly.io) (free to sign up)
- Your agent project directory with `Dockerfile` and `fly.toml` (created by `artificer init`)

## First-time deployment

### 1. Log in to Fly.io

```bash
fly auth login
```

### 2. Create the app

Pick a name that's unique across all of Fly.io — this becomes part of your URL (`https://<name>.fly.dev`).

```bash
fly apps create my-agent
```

Then update the `app` line in `fly.toml` to match:

```toml
app = "my-agent"
```

### 3. Create the persistent volume

Agent data (workstreams, runs, memories) is stored on a persistent volume so it survives redeploys.

```bash
fly volumes create artificer_data --size 1 --region ord
```

Pick the region closest to you. List available regions with `fly platform regions`.

### 4. Set secrets

Secrets are injected as environment variables at runtime and are never baked into the Docker image.

```bash
# Your LLM gateway key (required)
fly secrets set LLM_API_KEY=sk-...

# API key protecting your instance's UI and API (required for cloud deployment)
# Anyone with this key can send messages to your agent — keep it private.
ARTIFICER_API_KEY=$(openssl rand -hex 32)
echo "$ARTIFICER_API_KEY"   # copy this now — Fly won't show it again
fly secrets set ARTIFICER_API_KEY="$ARTIFICER_API_KEY"
```

Save the printed `ARTIFICER_API_KEY` somewhere safe (password manager, 1Password, etc.) before closing the terminal — you'll need it the first time you open the UI. Fly stores secret names but not values, so you can't retrieve it later.

Optional secrets:

```bash
# Agent GitHub identity (enables git push, PR creation, and PR watching)
fly secrets set GITHUB_TOKEN=ghp_...
fly secrets set GITHUB_USER_NAME="Agent Name"
fly secrets set GITHUB_USER_EMAIL="agent@users.noreply.github.com"
```

### 5. Deploy

```bash
fly deploy
```

Fly builds the Docker image, pushes it, and starts the machine. The first build takes a few minutes. Watch the logs with:

```bash
fly logs
```

### 6. Open the UI

```bash
fly open
```

The UI will show a login screen. Enter the value of `ARTIFICER_API_KEY` you set in step 4. The key is stored in your browser's `localStorage` — you only need to enter it once per browser.

Your agent is now live at `https://my-agent.fly.dev`.

## Updating

After making changes to your agent (instructions, tools, config), redeploy with:

```bash
fly deploy
```

The machine is replaced with zero downtime. Persistent data on `/data` is preserved across deploys.

## Useful commands

```bash
fly logs                  # stream live logs
fly status                # machine health and recent deploys
fly ssh console           # SSH into the running container
fly secrets list          # list secret names (not values)
fly secrets set KEY=val   # add or update a secret (triggers a restart)
fly scale show            # show current VM size
fly scale memory 1024     # scale to 1GB RAM if the agent is memory-constrained
```

## Choosing a region

Set `primary_region` in `fly.toml` to the region closest to where you'll be using the agent. This minimizes latency for the UI.

Common choices:
- `ord` — Chicago (central US)
- `iad` — Ashburn, VA (east US)
- `sjc` — San Jose, CA (west US)
- `lhr` — London
- `ams` — Amsterdam
- `nrt` — Tokyo
- `syd` — Sydney

## Cost estimate

A `shared-cpu-1x` machine with 512MB RAM running continuously costs around **$3–5/month**. The 1GB persistent volume adds roughly **$0.15/month**.

Total: **~$3–5/month** for a personal always-on instance.

If you want to reduce cost further, you can set `auto_stop_machines = "stop"` and `min_machines_running = 0` in `fly.toml`. The machine will suspend when idle and wake on the next HTTP request (~1–2 second cold start). Note that background work (GitHub watching, resuming workstreams) won't run while suspended.

## Data and persistence

All agent data lives on the Fly volume at `/data`:
- `ARTIFICER_DATA_DIR=/data` — workstreams, runs, workspace files
- `ARTIFICER_IDENTITY_DIR=/data/identity` — agent memories

Both are set in `fly.toml` by default. The `identity/` directory in your project is baked into the image at deploy time as the initial seed — after that, memories written by the agent accumulate on the volume and persist across redeploys.

To back up your data:

```bash
fly ssh console -C "tar czf - /data" > backup.tar.gz
```
