import { z } from 'zod';

export enum AgentStatus {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR',
  STOPPING = 'STOPPING',
}

export enum ActivityType {
  COMMIT_CREATED = 'COMMIT_CREATED',
  PR_OPENED = 'PR_OPENED',
  PR_REVIEWED = 'PR_REVIEWED',
  PR_MERGED = 'PR_MERGED',
  ISSUE_COMMENTED = 'ISSUE_COMMENTED',
  CODE_CHANGE = 'CODE_CHANGE',
  ERROR = 'ERROR',
}

export enum Role {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export const OpenCodeAgentConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxSteps: z.number().min(1).max(100).optional(),
  systemPrompt: z.string().optional(),
  permissions: z
    .object({
      bash: z.enum(['allow', 'ask', 'deny']).optional(),
      edit: z.enum(['allow', 'ask', 'deny']).optional(),
      write: z.enum(['allow', 'ask', 'deny']).optional(),
      webfetch: z.enum(['allow', 'ask', 'deny']).optional(),
    })
    .optional(),
});

export type OpenCodeAgentConfig = z.infer<typeof OpenCodeAgentConfigSchema>;

export const AVAILABLE_MODELS = [
  {
    id: 'anthropic/claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-haiku-3-20250514',
    name: 'Claude Haiku 3',
    provider: 'Anthropic',
  },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
] as const;

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  githubUsername: z.string().min(1),
  githubEmail: z.string().email(),
  githubToken: z.string().min(1),
  anthropicApiKey: z.string().min(1),
  teamId: z.string().optional(),
  opencodeConfig: OpenCodeAgentConfigSchema.optional(),
});

export const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  opencodeConfig: OpenCodeAgentConfigSchema.optional(),
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;

// Activity metadata types
export interface CommitMetadata {
  repository: string;
  sha: string;
  message: string;
  branch: string;
  filesChanged: number;
}

export interface PullRequestMetadata {
  repository: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  baseBranch: string;
}

export interface ErrorMetadata {
  message: string;
  stack?: string;
  code?: string;
}

export type ActivityMetadata =
  | CommitMetadata
  | PullRequestMetadata
  | ErrorMetadata
  | Record<string, unknown>;
