import {
  OpenCodeClient,
  type TokenUsage,
  type MessageResponse,
} from './client';

export interface CostConfig {
  model: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
}

export const MODEL_COSTS: Record<string, CostConfig> = {
  'anthropic/claude-sonnet-4-20250514': {
    model: 'claude-sonnet-4-20250514',
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
  },
  'anthropic/claude-opus-4-20250514': {
    model: 'claude-opus-4-20250514',
    inputCostPer1M: 15.0,
    outputCostPer1M: 75.0,
  },
  'anthropic/claude-haiku-3-20250514': {
    model: 'claude-haiku-3-20250514',
    inputCostPer1M: 0.8,
    outputCostPer1M: 4.0,
  },
  'openai/gpt-4o': {
    model: 'gpt-4o',
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
  },
  'openai/gpt-4o-mini': {
    model: 'gpt-4o-mini',
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
  },
};

export interface TrackedTokenUsage extends TokenUsage {
  costUSD: number;
  timestamp: Date;
  durationMs: number;
  sessionId: string;
}

export interface UsageRecord {
  sessionId: string;
  agentId: string;
  usage: TrackedTokenUsage;
}

export interface TokenTrackerOptions {
  agentId: string;
  modelCosts?: Record<string, CostConfig>;
}

export class TokenTracker {
  private agentId: string;
  private modelCosts: Record<string, CostConfig>;
  private usageRecords: UsageRecord[] = [];

  constructor(options: TokenTrackerOptions) {
    this.agentId = options.agentId;
    this.modelCosts = options.modelCosts || MODEL_COSTS;
  }

  calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const costs = this.modelCosts[model];
    if (!costs) {
      return 0;
    }

    const inputCost = (inputTokens / 1_000_000) * costs.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * costs.outputCostPer1M;

    return inputCost + outputCost;
  }

  track(
    sessionId: string,
    response: MessageResponse,
    durationMs: number,
  ): TrackedTokenUsage {
    const model = response.tokenUsage?.model || 'unknown';
    const inputTokens = response.tokenUsage?.inputTokens || 0;
    const outputTokens = response.tokenUsage?.outputTokens || 0;

    const usage: TrackedTokenUsage = {
      model,
      inputTokens,
      outputTokens,
      costUSD: this.calculateCost(model, inputTokens, outputTokens),
      timestamp: new Date(),
      durationMs,
      sessionId,
    };

    this.usageRecords.push({
      sessionId,
      agentId: this.agentId,
      usage,
    });

    return usage;
  }

  getUsage(): UsageRecord[] {
    return [...this.usageRecords];
  }

  getTotalCost(): number {
    return this.usageRecords.reduce(
      (sum, record) => sum + record.usage.costUSD,
      0,
    );
  }

  getUsageBySession(sessionId: string): UsageRecord[] {
    return this.usageRecords.filter((r) => r.sessionId === sessionId);
  }

  clearUsage(): void {
    this.usageRecords = [];
  }
}

export interface TrackedOpenCodeClientOptions {
  opencodeClient: OpenCodeClient;
  agentId: string;
  modelCosts?: Record<string, CostConfig>;
}

export class TrackedOpenCodeClient {
  private client: OpenCodeClient;
  private tracker: TokenTracker;

  constructor(options: TrackedOpenCodeClientOptions) {
    this.client = options.opencodeClient;
    this.tracker = new TokenTracker({
      agentId: options.agentId,
      modelCosts: options.modelCosts,
    });
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
    const response = await this.client.sendMessage(sessionId, message, options);
    const duration = Date.now() - startTime;

    this.tracker.track(sessionId, response, duration);

    return response;
  }

  async runShell(
    sessionId: string,
    command: string,
    options?: { agent?: string; model?: string },
  ): Promise<MessageResponse> {
    const startTime = Date.now();
    const response = await this.client.runShell(sessionId, command, options);
    const duration = Date.now() - startTime;

    this.tracker.track(sessionId, response, duration);

    return response;
  }

  getTracker(): TokenTracker {
    return this.tracker;
  }

  getClient(): OpenCodeClient {
    return this.client;
  }
}

export function createTrackedClient(
  options: TrackedOpenCodeClientOptions,
): TrackedOpenCodeClient {
  return new TrackedOpenCodeClient(options);
}
