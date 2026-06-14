import { z } from 'zod';

// --- Runtime client (packages/runtime HTTP API) ---

export const RuntimeClientConfigSchema = z.object({
  baseUrl: z.string().url(),
  authToken: z.string().optional(),
});

export type RuntimeClientConfig = z.infer<typeof RuntimeClientConfigSchema>;

export interface RuntimeHealth {
  ok: boolean;
  agent: string;
}

export interface RuntimeQueueState {
  pending: number;
  running: number;
}

export interface RuntimeWorkstreamSummary {
  id: string;
  title: string;
  status: string;
  summary?: string;
  updatedAt: string;
}

export interface RuntimeState {
  agentName: string;
  busy: boolean;
  queue: RuntimeQueueState;
  activeRuns: unknown[];
  workstreams: RuntimeWorkstreamSummary[];
}

export interface RuntimeMessage {
  id: string;
  direction: string;
  content: string;
  createdAt: string;
}

export interface SendMessageResult {
  message: RuntimeMessage;
}

// --- Legacy OpenCode gateway (apps/web EC2 agents) ---

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
