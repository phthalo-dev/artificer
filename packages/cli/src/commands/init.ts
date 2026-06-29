import fs from 'node:fs';
import path from 'node:path';

/** Keep in sync with the async-economy preset in @artificer-ai/runtime. */
const DEFAULT_PRESET_ID = 'async-economy';
const DEFAULT_MODELS = {
  low: 'gpt-5-nano',
  medium: 'gpt-5.4-mini',
  high: 'gpt-5.4',
} as const;
const DEFAULT_ROLE_TIERS = {
  communicator: 'low',
  orchestrator: 'low',
  planner: 'medium',
  reviewer: 'low',
  worker: 'medium',
  librarian: 'low',
} as const;

/** Default daily spend cap for the primary Zen route (overridable via QUOTA_DAILY_BUDGET_USD). */
const DEFAULT_DAILY_BUDGET_USD = 10;

const DEFAULT_LLM_BASE_URL = 'https://opencode.ai/zen/v1';

export function makeConfigJson(name: string): string {
  return (
    JSON.stringify(
      {
        $schema:
          './node_modules/@artificer-ai/runtime/artificer.config.schema.json',
        name,
        description: 'An Artificer agent',
        preset: DEFAULT_PRESET_ID,
        identity: {
          autoCommit: true,
          autoPush: false,
        },
        quota: {
          reservePercent: 10,
          routes: [
            {
              id: 'primary',
              accountId: 'opencode-zen',
              mode: 'metered',
              execution: 'llm',
              llm: { baseURL: DEFAULT_LLM_BASE_URL },
              presetId: DEFAULT_PRESET_ID,
              models: { ...DEFAULT_MODELS },
              roleTiers: { ...DEFAULT_ROLE_TIERS },
              windows: [
                {
                  id: 'daily-budget',
                  unit: 'dollars',
                  period: 'daily',
                  scope: 'global',
                  limit: DEFAULT_DAILY_BUDGET_USD,
                  warnAtPercent: 70,
                  blockAtPercent: 90,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ) + '\n'
  );
}

const GITIGNORE_TEMPLATE = `.env
node_modules/
# Uncomment if you override ARTIFICER_EXEC_DIR to a local path:
# .artificer/
`;

const ENV_EXAMPLE = `# LLM gateway (required)
LLM_API_KEY=
# LLM_BASE_URL=https://opencode.ai/zen/v1   # default; override for a different gateway

# Agent identity
# AGENT_NAME=                                # overrides the name in artificer.config.ts

# Model selection (preset covers all tiers by default; override individual tiers here)
# MODEL_PRESET=async-economy                 # see presets in @artificer/runtime
# LLM_MODEL=                                 # medium-complexity tier (planner, reviewer)
# LLM_MODEL_LOW=                             # low-complexity tier (communicator)
# LLM_MODEL_HIGH=                            # high-complexity tier (worker)

# Agent GitHub identity (optional — enables git push, gh pr create, and PR watching)
# GITHUB_TOKEN=
# GITHUB_USER_NAME=
# GITHUB_USER_EMAIL=
# GITHUB_WATCH_INTERVAL_MS=                  # poll interval for the agent's own PRs (ms)

# API authentication (required in production)
# ARTIFICER_API_KEY=

# Paths (optional — defaults shown)
# ARTIFICER_EXEC_DIR=~/.artificer/<name>     # where runs, workstreams, and workspace live
# ARTIFICER_IDENTITY_DIR=.                   # root of the identity repo (default: cwd)

# Runtime tuning (optional)
# PORT=4100
# RUNTIME_CONCURRENCY=2                      # max parallel LLM calls
# RUNTIME_MAX_RUNS_PER_WORKSTREAM=60
# RUNTIME_MAX_ITERATIONS=24                  # tool-use iterations per call
# RUNTIME_RESUME_ON_STARTUP=true             # resume interrupted workstreams on restart

# Quota & provider routes (defaults in artificer.config.json; env overrides at runtime)
# QUOTA_DAILY_BUDGET_USD=10                  # overrides the daily-budget window limit
# QUOTA_RESERVE_PERCENT=10                   # % held for communicator replies near cap
# QUOTA_ON_EXHAUSTED=wait                    # wait | failover (meaningful with 2+ routes)

# Connection credentials
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

  fs.mkdirSync(path.join(dir, 'agent', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agent', 'channels'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agent', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'identity', 'memories'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'artificer.config.json'),
    makeConfigJson(name),
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
        dependencies: { '@artificer-ai/runtime': 'latest' },
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
