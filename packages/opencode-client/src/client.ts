import { z } from 'zod';

export const OpenCodeConfigSchema = z.object({
  hostname: z.string(),
  port: z.number().default(4096),
  username: z.string().default('opencode'),
  password: z.string(),
});

export type OpenCodeConfig = z.infer<typeof OpenCodeConfigSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Session = z.infer<typeof SessionSchema>;

export const MessageSchema = z.object({
  info: z.object({
    id: z.string(),
    role: z.string(),
    createdAt: z.string(),
  }),
  parts: z.array(z.unknown()),
});

export type Message = z.infer<typeof MessageSchema>;

export interface MessageResponse {
  info: Message['info'];
  parts: Message['parts'];
  tokenUsage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface FileContent {
  content: string;
  language?: string;
  truncated?: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface AgentInfo {
  description: string;
  mode: 'primary' | 'subagent';
  model?: string;
  tools?: Record<string, boolean>;
}

export class OpenCodeClient {
  private baseUrl: string;
  private auth: string;

  constructor(config: OpenCodeConfig) {
    const { hostname, port, username, password } =
      OpenCodeConfigSchema.parse(config);
    this.baseUrl = `http://${hostname}:${port}`;
    this.auth = Buffer.from(`${username}:${password}`).toString('base64');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenCode API error: ${response.status} ${error}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async healthCheck(): Promise<{ healthy: boolean; version: string }> {
    return this.request('GET', '/global/health');
  }

  async listSessions(): Promise<Session[]> {
    return this.request('GET', '/session');
  }

  async createSession(options?: {
    parentID?: string;
    title?: string;
  }): Promise<Session> {
    return this.request('POST', '/session', options || {});
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request('GET', `/session/${sessionId}`);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.request('DELETE', `/session/${sessionId}`);
  }

  async sendMessage(
    sessionId: string,
    message: string,
    options?: {
      model?: string;
      agent?: string;
      system?: string;
    },
  ): Promise<MessageResponse> {
    const startTime = Date.now();

    const response = await this.request<MessageResponse>(
      'POST',
      `/session/${sessionId}/message`,
      {
        parts: [{ type: 'text', content: message }],
        ...options,
      },
    );

    const duration = Date.now() - startTime;

    return {
      ...response,
      tokenUsage: response.tokenUsage
        ? {
            ...response.tokenUsage,
            inputTokens: response.tokenUsage.inputTokens || 0,
            outputTokens: response.tokenUsage.outputTokens || 0,
          }
        : undefined,
    };
  }

  async sendMessageAsync(
    sessionId: string,
    message: string,
    options?: {
      model?: string;
      agent?: string;
      system?: string;
    },
  ): Promise<void> {
    await this.request('POST', `/session/${sessionId}/prompt_async`, {
      parts: [{ type: 'text', content: message }],
      ...options,
    });
  }

  async abortSession(sessionId: string): Promise<boolean> {
    return this.request('POST', `/session/${sessionId}/abort`);
  }

  async getSessionMessages(
    sessionId: string,
    limit?: number,
  ): Promise<{ info: Message['info']; parts: Message['parts'] }[]> {
    const params = limit ? `?limit=${limit}` : '';
    return this.request('GET', `/session/${sessionId}/message${params}`);
  }

  async initSession(
    sessionId: string,
    options?: { messageID?: string; providerID?: string; modelID?: string },
  ): Promise<boolean> {
    return this.request('POST', `/session/${sessionId}/init`, options || {});
  }

  async runShell(
    sessionId: string,
    command: string,
    options?: { agent?: string; model?: string },
  ): Promise<MessageResponse> {
    return this.request('POST', `/session/${sessionId}/shell`, {
      command,
      ...options,
    });
  }

  async executeCommand(
    sessionId: string,
    command: string,
    arguments_?: string,
  ): Promise<MessageResponse> {
    return this.request('POST', `/session/${sessionId}/command`, {
      command,
      arguments: arguments_,
    });
  }

  async getFileContent(path: string): Promise<FileContent> {
    return this.request(
      'GET',
      `/file/content?path=${encodeURIComponent(path)}`,
    );
  }

  async listFiles(path: string): Promise<FileNode[]> {
    return this.request('GET', `/file?path=${encodeURIComponent(path)}`);
  }

  async findFiles(
    query: string,
    options?: { type?: 'file' | 'directory'; limit?: number },
  ): Promise<string[]> {
    const params = new URLSearchParams({ query });
    if (options?.type) params.append('type', options.type);
    if (options?.limit) params.append('limit', String(options.limit));
    return this.request('GET', `/find/file?${params.toString()}`);
  }

  async findSymbols(
    query: string,
  ): Promise<{ name: string; path: string; kind: string }[]> {
    return this.request(
      'GET',
      `/find/symbol?query=${encodeURIComponent(query)}`,
    );
  }

  async findInFiles(
    pattern: string,
    options?: { directory?: string },
  ): Promise<{ path: string; lines: string; line_number: number }[]> {
    const params = new URLSearchParams({ pattern });
    if (options?.directory) params.append('directory', options.directory);
    return this.request('GET', `/find?${params.toString()}`);
  }

  async listAgents(): Promise<{ name: string } & AgentInfo[]> {
    return this.request('GET', '/agent');
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.request('GET', '/config');
  }

  async updateConfig(
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request('PATCH', '/config', config);
  }

  async getProviders(): Promise<{
    all: { id: string; name: string }[];
    default: Record<string, string>;
    connected: string[];
  }> {
    return this.request('GET', '/provider');
  }

  async dispose(): Promise<boolean> {
    return this.request('POST', '/instance/dispose');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export function createOpenCodeClient(config: OpenCodeConfig): OpenCodeClient {
  return new OpenCodeClient(config);
}
