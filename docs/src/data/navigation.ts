import type { DocsSearchItem, SidebarSection } from '@var-ui/docs';

export const docsSidebarSections: SidebarSection[] = [
  {
    title: 'Introduction',
    items: [
      { text: 'What is Artificer?', link: '/docs/introduction/what-is-artificer' },
      { text: 'How it works', link: '/docs/introduction/how-it-works' },
    ],
  },
  {
    title: 'Getting started',
    items: [
      { text: 'Quickstart', link: '/docs/getting-started/quickstart' },
      { text: 'Core concepts', link: '/docs/getting-started/core-concepts' },
    ],
  },
  {
    title: 'Guides',
    items: [
      { text: 'Agent identity setup', link: '/docs/guides/agent-identity-setup' },
      { text: 'Writing good goals', link: '/docs/guides/writing-good-goals' },
      { text: 'Slack & Discord', link: '/docs/guides/slack-discord-connections' },
      { text: 'Custom tools', link: '/docs/guides/writing-custom-tools' },
      { text: 'Custom channels', link: '/docs/guides/writing-custom-channels' },
      { text: 'Managing memories', link: '/docs/guides/managing-memories' },
      { text: 'Custom CLI executors', link: '/docs/guides/custom-cli-executor' },
      { text: 'opencode executor', link: '/docs/guides/opencode-executor' },
      { text: 'Qwen Code executor', link: '/docs/guides/qwen-code-executor' },
      { text: 'Agent evals', link: '/docs/guides/agent-evals' },
      { text: 'Open-weights inference', link: '/docs/guides/open-weights-inference' },
      { text: 'Deploying to production', link: '/docs/guides/deploying-to-production' },
      { text: 'Deploying to Fly.io', link: '/docs/guides/deploying-to-fly' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { text: 'CLI', link: '/docs/reference/cli' },
      { text: 'Config', link: '/docs/reference/config' },
      { text: 'Environment variables', link: '/docs/reference/env-vars' },
      { text: 'HTTP API', link: '/docs/reference/api' },
      { text: 'Roles', link: '/docs/reference/roles' },
      { text: 'Schedules', link: '/docs/reference/schedules' },
    ],
  },
];

export const docsSearchItems: DocsSearchItem[] = [
  { id: 'docs', title: 'Documentation', meta: 'Overview', group: 'Guides', keywords: ['docs', 'hub'] },
  { id: 'what-is-artificer', title: 'What is Artificer?', meta: 'Introduction', group: 'Introduction', keywords: ['intro', 'overview'] },
  { id: 'how-it-works', title: 'How it works', meta: 'Introduction', group: 'Introduction', keywords: ['orchestration', 'roles'] },
  { id: 'quickstart', title: 'Quickstart', meta: 'Getting started', group: 'Getting started', keywords: ['start', 'install'] },
  { id: 'core-concepts', title: 'Core concepts', meta: 'Getting started', group: 'Getting started', keywords: ['workstream', 'identity'] },
  { id: 'agent-identity-setup', title: 'Agent identity setup', meta: 'Guides', group: 'Guides', keywords: ['github', 'identity'] },
  { id: 'writing-good-goals', title: 'Writing good goals', meta: 'Guides', group: 'Guides', keywords: ['goals', 'plan'] },
  { id: 'slack-discord-connections', title: 'Slack & Discord', meta: 'Guides', group: 'Guides', keywords: ['slack', 'discord', 'channel'] },
  { id: 'writing-custom-tools', title: 'Custom tools', meta: 'Guides', group: 'Guides', keywords: ['tools'] },
  { id: 'writing-custom-channels', title: 'Custom channels', meta: 'Guides', group: 'Guides', keywords: ['channels'] },
  { id: 'managing-memories', title: 'Managing memories', meta: 'Guides', group: 'Guides', keywords: ['memory'] },
  { id: 'custom-cli-executor', title: 'Custom CLI executors', meta: 'Guides', group: 'Guides', keywords: ['cli', 'executor'] },
  { id: 'opencode-executor', title: 'opencode executor', meta: 'Guides', group: 'Guides', keywords: ['opencode'] },
  { id: 'qwen-code-executor', title: 'Qwen Code executor', meta: 'Guides', group: 'Guides', keywords: ['qwen'] },
  { id: 'agent-evals', title: 'Agent evals', meta: 'Guides', group: 'Guides', keywords: ['eval', 'bench'] },
  { id: 'open-weights-inference', title: 'Open-weights inference', meta: 'Guides', group: 'Guides', keywords: ['weights', 'zen'] },
  { id: 'deploying-to-production', title: 'Deploying to production', meta: 'Guides', group: 'Guides', keywords: ['deploy', 'docker'] },
  { id: 'deploying-to-fly', title: 'Deploying to Fly.io', meta: 'Guides', group: 'Guides', keywords: ['fly'] },
  { id: 'cli', title: 'CLI', meta: 'Reference', group: 'Reference', keywords: ['cli'] },
  { id: 'config', title: 'Config', meta: 'Reference', group: 'Reference', keywords: ['config'] },
  { id: 'env-vars', title: 'Environment variables', meta: 'Reference', group: 'Reference', keywords: ['env'] },
  { id: 'api', title: 'HTTP API', meta: 'Reference', group: 'Reference', keywords: ['api'] },
  { id: 'roles', title: 'Roles', meta: 'Reference', group: 'Reference', keywords: ['roles'] },
  { id: 'schedules', title: 'Schedules', meta: 'Reference', group: 'Reference', keywords: ['cron', 'schedule'] },
];
