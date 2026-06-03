import {
  OpenCodeClient,
  createOpenCodeClient,
  MessageResponse,
} from '@artificer/opencode-client';
import {
  AgentConfig,
  SendPromptOptions,
  PromptResponse,
  SessionInfo,
  AgentStatus,
} from './types.js';

/** @deprecated Use RuntimeClient for packages/runtime agents. */
export class AgentGateway {
  private client: OpenCodeClient | null = null;
  private config: AgentConfig | null = null;

  constructor(config: AgentConfig) {
    if (!config.ec2PublicIp) {
      throw new Error('Agent does not have a public IP address');
    }
    this.config = config;
    this.client = createOpenCodeClient({
      hostname: config.ec2PublicIp,
      port: 4096,
      username: 'opencode',
      password: config.opencodePassword,
    });
  }

  async checkHealth(): Promise<AgentStatus> {
    if (!this.client) {
      return { isHealthy: false, error: 'Agent not initialized' };
    }

    try {
      const health = await this.client.healthCheck();
      return {
        isHealthy: health.healthy,
        version: health.version,
      };
    } catch (error) {
      return {
        isHealthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async createSession(title?: string): Promise<SessionInfo> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    const session = await this.client.createSession({ title });
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async sendPrompt(
    sessionId: string,
    prompt: string,
    options?: SendPromptOptions,
  ): Promise<PromptResponse> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    const response = await this.client.sendMessage(sessionId, prompt, {
      model: options?.model,
      system: options?.system,
    });

    const content = this.extractContent(response.parts);

    return {
      sessionId,
      messageId: response.info.id,
      role: response.info.role as 'user' | 'assistant',
      content,
      tokenUsage: response.tokenUsage
        ? {
            inputTokens: response.tokenUsage.inputTokens,
            outputTokens: response.tokenUsage.outputTokens,
            model: response.tokenUsage.model,
          }
        : undefined,
    };
  }

  async sendPromptAsync(
    sessionId: string,
    prompt: string,
    options?: SendPromptOptions,
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    await this.client.sendMessageAsync(sessionId, prompt, {
      model: options?.model,
      system: options?.system,
    });
  }

  async abortSession(sessionId: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    return this.client.abortSession(sessionId);
  }

  async getSessionMessages(
    sessionId: string,
    limit?: number,
  ): Promise<
    {
      info: { id: string; role: string; createdAt: string };
      parts: unknown[];
    }[]
  > {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    return this.client.getSessionMessages(sessionId, limit);
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    const sessions = await this.client.listSessions();
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    return this.client.deleteSession(sessionId);
  }

  async runShell(sessionId: string, command: string): Promise<MessageResponse> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    return this.client.runShell(sessionId, command);
  }

  getConfig(): AgentConfig | null {
    return this.config;
  }

  private extractContent(parts: unknown[]): string {
    const textParts: string[] = [];

    for (const part of parts) {
      if (part && typeof part === 'object' && 'type' in part) {
        const p = part as { type: string; content?: string; text?: string };
        if (p.type === 'text' && (p.text || p.content)) {
          textParts.push(p.text || p.content || '');
        }
      }
    }

    return textParts.join('\n');
  }
}

/** @deprecated Use createRuntimeClient for packages/runtime agents. */
export function createAgentGateway(config: AgentConfig): AgentGateway {
  return new AgentGateway(config);
}
