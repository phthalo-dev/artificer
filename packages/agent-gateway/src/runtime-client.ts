import {
  RuntimeClientConfig,
  RuntimeHealth,
  RuntimeState,
  SendMessageResult,
} from './types.js';

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;

  constructor(config: RuntimeClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Runtime ${method} ${path} failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`,
      );
    }

    return (await res.json()) as T;
  }

  async getHealth(): Promise<RuntimeHealth> {
    return this.request<RuntimeHealth>('GET', '/health');
  }

  async getState(): Promise<RuntimeState> {
    return this.request<RuntimeState>('GET', '/state');
  }

  /** Returns true when the runtime responds and reports healthy. */
  async isHealthy(): Promise<boolean> {
    try {
      const health = await this.getHealth();
      return health.ok;
    } catch {
      return false;
    }
  }

  /** Returns true when no scheduler work is pending or running. */
  async isIdle(): Promise<boolean> {
    const state = await this.getState();
    return !state.busy;
  }

  async sendMessage(content: string): Promise<SendMessageResult> {
    return this.request<SendMessageResult>('POST', '/messages', { content });
  }

  async waitUntilHealthy(
    timeoutMs = 300_000,
    intervalMs = 5_000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) return;
      await sleep(intervalMs);
    }
    throw new Error(`Runtime at ${this.baseUrl} did not become healthy in time`);
  }
}

export function createRuntimeClient(config: RuntimeClientConfig): RuntimeClient {
  return new RuntimeClient(config);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
