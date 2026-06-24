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

  fs.mkdirSync(path.join(dir, 'agent', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agent', 'channels'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agent', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'identity', 'memories'), { recursive: true });

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
