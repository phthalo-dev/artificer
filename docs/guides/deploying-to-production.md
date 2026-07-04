# Deploying to Production

Production mode adds API key authentication and (optionally) runs from a container image. This guide covers: securing the API, choosing a deployment target, and using `IDENTITY_REPO` to pull the agent's identity from GitHub at boot so the container stays stateless.

## Secure the API

In development, `artificer dev` runs without authentication. In production, set `ARTIFICER_API_KEY`:

```bash
# Generate a secure key
openssl rand -hex 32

# Add to .env
ARTIFICER_API_KEY=<your-generated-key>
```

Then start with `artificer start` instead of `artificer dev`. All `/api/*` routes require `Authorization: Bearer <key>`. The web UI handles authentication client-side.

If `ARTIFICER_API_KEY` is not set, `artificer start` will warn at startup and the API will be unprotected — do not deploy this way.

## The `IDENTITY_REPO` pattern (for container deploys)

When running in a container, you don't want to bake the identity repo into the image (it contains your `agent/instructions.md`, tools, and memories). Instead, set `IDENTITY_REPO` to pull it at startup:

```bash
# .env (or container environment)
IDENTITY_REPO=your-github-org/your-agent-repo
GITHUB_TOKEN=github_pat_...  # must have read access to the identity repo
```

At startup, `artificer start` clones (or pulls) the identity repo before starting the agent. If a clone already exists at the destination, it resets to HEAD and pulls — this handles restarts gracefully on a persistent volume. The identity lands at `IDENTITY_DIR` (default: `/data/identity` inside containers). Execution state goes to `ARTIFICER_EXEC_DIR` (default: `/data`).

`GH_TOKEN` is accepted as an alias for `GITHUB_TOKEN`.

This pattern keeps the container image generic — only environment variables differ between agents.

## Deploy to Fly.io

Fly.io is a good choice for personal or small-team self-hosting. You get always-on compute, a persistent volume for agent data, and HTTPS out of the box for around $3–5/month.

### Prerequisites

- [flyctl](https://fly.io/docs/flyctl/install/) installed (`brew install flyctl` on macOS)
- A [Fly.io account](https://fly.io) (free to sign up)
- Your agent project directory with `Dockerfile` and `fly.toml`

### 1. Log in to Fly.io

```bash
fly auth login
```

### 2. Create the app

Pick a name that is unique across all of Fly.io — this becomes part of your URL (`https://<name>.fly.dev`).

```bash
fly apps create my-agent
```

Then update the `app` line in `fly.toml` to match:

```toml
app = "my-agent"
```

### 3. Create the persistent volume

Agent data (workstreams, runs, memories) is stored on a persistent volume so it survives redeploys. The `fly.toml` mounts this volume at `/data`.

```bash
fly volumes create artificer_data --size 1 --region ord
```

Pick the region closest to you. List available regions with `fly platform regions`.

### 4. Set secrets

Secrets are injected as environment variables at runtime and are never baked into the Docker image.

```bash
# Your LLM gateway key (required)
fly secrets set LLM_API_KEY=sk-...

# API key protecting your instance's UI and API (required)
# Anyone with this key can send messages to your agent — keep it private.
ARTIFICER_API_KEY=$(openssl rand -hex 32)
echo "$ARTIFICER_API_KEY"   # copy this now — Fly won't show it again
fly secrets set ARTIFICER_API_KEY="$ARTIFICER_API_KEY"
```

Save the printed `ARTIFICER_API_KEY` somewhere safe before closing the terminal — Fly stores secret names but not values, so you cannot retrieve it later.

If using `IDENTITY_REPO`:

```bash
fly secrets set IDENTITY_REPO=your-github-org/your-agent-repo
fly secrets set GITHUB_TOKEN=github_pat_...
```

Without `IDENTITY_REPO`, you can set the agent's GitHub identity directly:

```bash
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

### Updating

After making changes to your agent, redeploy with:

```bash
fly deploy
```

The machine is replaced with zero downtime. Persistent data on `/data` is preserved across redeploys.

### Useful commands

```bash
fly logs                  # stream live logs
fly status                # machine health and recent deploys
fly ssh console           # SSH into the running container
fly secrets list          # list secret names (not values)
fly secrets set KEY=val   # add or update a secret (triggers a restart)
fly scale show            # show current VM size
fly scale memory 1024     # scale to 1GB RAM if the agent is memory-constrained
```

### Cost estimate

A `shared-cpu-1x` machine with 512MB RAM (the default in `fly.toml`) running continuously costs around **$3–5/month**. The 1GB persistent volume adds roughly **$0.15/month**.

If you want to reduce cost, set `auto_stop_machines = "stop"` and `min_machines_running = 0` in `fly.toml`. The machine will suspend when idle and wake on the next HTTP request (~1–2 second cold start). Note that background work (GitHub watching, resuming workstreams) will not run while suspended.

### Choosing a region

Set `primary_region` in `fly.toml` to the region closest to where you will use the agent. This minimizes latency for the UI.

Common choices:
- `ord` — Chicago (central US, the default)
- `iad` — Ashburn, VA (east US)
- `sjc` — San Jose, CA (west US)
- `lhr` — London
- `ams` — Amsterdam
- `nrt` — Tokyo
- `syd` — Sydney

## Deploy with Docker

For self-hosted or other platforms, you can run the pre-built image or build it yourself from the `Dockerfile`.

### Build the image

```bash
docker build -t artificer:latest .
```

### Run the container

```bash
docker run -d \
  --name artificer \
  -p 4100:4100 \
  -v artificer_data:/data \
  -e ARTIFICER_API_KEY=<your-key> \
  -e LLM_API_KEY=<your-llm-key> \
  -e IDENTITY_REPO=your-github-org/your-agent-repo \
  -e GITHUB_TOKEN=<your-pat> \
  artificer:latest
```

The volume mount at `/data` persists workstreams, runs, and the cloned identity repo across container restarts.

To use a `.env` file instead of individual `-e` flags:

```bash
docker run -d \
  --name artificer \
  -p 4100:4100 \
  -v artificer_data:/data \
  --env-file .env \
  artificer:latest
```

### View logs

```bash
docker logs -f artificer
```

The agent UI is available at `http://localhost:4100`.

## Environment variables for production

| Variable | Required | Purpose |
|---|---|---|
| `ARTIFICER_API_KEY` | Yes | API bearer token |
| `LLM_API_KEY` | Yes | LLM provider key |
| `IDENTITY_REPO` | Container deploys | GitHub repo to pull at boot (e.g. `your-org/your-agent`) |
| `GITHUB_TOKEN` | With IDENTITY_REPO | PAT with read access to the identity repo (alias: `GH_TOKEN`) |
| `IDENTITY_DIR` | No | Where to clone the identity repo (default: `/data/identity`) |
| `ARTIFICER_EXEC_DIR` | No | Execution data directory (default: `/data` in containers) |
| `PORT` | No | HTTP port (default: `4100`) |

## Next steps

- [Agent identity setup](./agent-identity-setup.md) — setting up the identity repo
- [Environment variables reference](../reference/env-vars.md) — complete env var list
- [infrastructure/README.md](../../infrastructure/README.md) — an alternative AWS path with hibernate-on-idle EC2, if you don't want an always-on Fly.io/Docker host
