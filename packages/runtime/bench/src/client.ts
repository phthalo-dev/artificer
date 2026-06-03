import type { UsageSummary, WorkstreamStatus } from './types.js';

export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
  workstreamId?: string;
}

export interface WorkstreamSummary {
  id: string;
  title: string;
  status: WorkstreamStatus;
  summary?: string;
  updatedAt?: string;
}

export interface RuntimeState {
  agentName: string;
  busy: boolean;
  queue: { pending: number; running: number };
  workstreams: WorkstreamSummary[];
}

/**
 * One node of the runtime's call tree. The harness treats this opaquely and
 * persists it verbatim so the UI can render a trajectory; the field shapes are
 * defined by the runtime's /messages/:id/cost endpoint.
 */
export interface RunNode {
  run: Record<string, unknown>;
  self: UsageSummary;
  cumulative: UsageSummary;
  children: RunNode[];
}

export interface MessageCost {
  message: Message;
  total: UsageSummary;
  byWorkstream: Record<string, UsageSummary>;
  byRole: Record<string, UsageSummary>;
  /** Nested call tree (communicator -> orchestrator -> planner/worker/...). */
  tree?: RunNode[];
}

/** Thin typed wrapper over the runtime's HTTP surface. */
export class RuntimeClient {
  constructor(public readonly baseUrl: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  /** True once the server answers /health. */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Send an inbound message; returns the persisted message (with its id). */
  async sendMessage(content: string): Promise<Message> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`POST /messages -> ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { message: Message };
    return body.message;
  }

  /**
   * Create a workstream directly (bypassing the communicator). With
   * autostart=false the orchestrator is held so the caller can preflight-clone
   * before any agent runs; call startWorkstreamWork to release it.
   */
  async createWorkstream(input: {
    title: string;
    goal: string;
    repoUrl?: string;
    baseCommit?: string;
    autostart?: boolean;
  }): Promise<{ workstreamId: string; messageId: string }> {
    const res = await fetch(`${this.baseUrl}/workstreams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`POST /workstreams -> ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as { workstreamId: string; messageId: string };
  }

  /** Release a workstream created with autostart=false (spawns orchestrator). */
  async startWorkstreamWork(
    workstreamId: string,
    messageId: string,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/workstreams/${workstreamId}/start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId }),
      },
    );
    if (!res.ok && res.status !== 202) {
      throw new Error(
        `POST /workstreams/${workstreamId}/start -> ${res.status} ${res.statusText}`,
      );
    }
  }

  async getState(): Promise<RuntimeState> {
    return this.get<RuntimeState>('/state');
  }

  async listWorkstreams(): Promise<WorkstreamSummary[]> {
    const body = await this.get<{ workstreams: WorkstreamSummary[] }>(
      '/workstreams',
    );
    return body.workstreams;
  }

  /** Cost + per-role usage for the call tree rooted at one inbound message. */
  async messageCost(messageId: string): Promise<MessageCost> {
    return this.get<MessageCost>(`/messages/${messageId}/cost`);
  }

  /** Aggregate usage across the whole runtime instance. */
  async usage(): Promise<{ total: UsageSummary }> {
    return this.get<{ total: UsageSummary }>('/usage');
  }
}
