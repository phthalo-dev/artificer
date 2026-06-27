import fs from 'node:fs';
import path from 'node:path';

function makeConfigJson(name: string): string {
  return (
    JSON.stringify(
      {
        $schema:
          './node_modules/@artificer-ai/runtime/artificer.config.schema.json',
        name,
        description: 'An Artificer agent',
        preset: 'async-economy',
        identity: {
          autoCommit: true,
          autoPush: false,
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
