import { z } from 'zod';

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  ec2PublicIp: z.string().nullable(),
  ec2PrivateIp: z.string().nullable(),
  opencodePassword: z.string(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export interface SendPromptOptions {
  model?: string;
  system?: string;
}

export interface PromptResponse {
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
}

export interface SessionInfo {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentStatus {
  isHealthy: boolean;
  version?: string;
  error?: string;
}
