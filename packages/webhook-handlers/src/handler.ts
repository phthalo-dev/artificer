import { createHmac } from 'crypto';
import {
  OpenCodeClient,
  createOpenCodeClient,
} from '@artificer/opencode-client';
import {
  verifyGitHubSignature,
  parseGitHubEvent,
  formatIssueCommentAsPrompt,
  formatPullRequestAsPrompt,
  formatPushAsPrompt,
  type GitHubEventType,
  type IssueCommentPayload,
  type PullRequestPayload,
  type PushEvent,
} from './github';

export interface AgentInfo {
  id: string;
  githubUsername: string;
  ec2PublicIp: string;
  opencodePassword: string;
}

export interface GitHubWebhookHandlerConfig {
  webhookSecret: string;
  getAgentByRepository: (repoFullName: string) => Promise<AgentInfo | null>;
  onSessionCreated?: (sessionId: string, agentId: string) => Promise<void>;
  onTokenUsage?: (
    agentId: string,
    usage: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number;
    },
  ) => Promise<void>;
}

export interface WebhookResult {
  success: boolean;
  message: string;
  sessionId?: string;
  response?: string;
}

export class GitHubWebhookHandler {
  private config: GitHubWebhookHandlerConfig;

  constructor(config: GitHubWebhookHandlerConfig) {
    this.config = config;
  }

  async handleWebhook(
    eventType: string | undefined,
    payloadString: string,
    signature: string | undefined,
  ): Promise<WebhookResult> {
    if (
      !verifyGitHubSignature(
        payloadString,
        signature,
        this.config.webhookSecret,
      )
    ) {
      return {
        success: false,
        message: 'Invalid signature',
      };
    }

    const payload = JSON.parse(payloadString);
    const { event, data } = parseGitHubEvent(eventType, payload);

    if (!data) {
      return {
        success: false,
        message: 'Unable to parse webhook payload',
      };
    }

    let prompt: string;
    let repoFullName: string;

    switch (event) {
      case 'issue_comment': {
        const issueData = data as IssueCommentPayload;
        if (issueData.action !== 'created') {
          return {
            success: true,
            message: 'Ignoring non-created comment action',
          };
        }
        prompt = formatIssueCommentAsPrompt(issueData);
        repoFullName = issueData.repository.full_name;
        break;
      }
      case 'pull_request':
      case 'pull_request_review':
      case 'pull_request_review_comment': {
        const prData = data as PullRequestPayload;
        const allowedActions = ['opened', 'synchronize', 'reopened'];
        if (!allowedActions.includes(prData.action)) {
          return {
            success: true,
            message: `Ignoring ${prData.action} action`,
          };
        }
        prompt = formatPullRequestAsPrompt(prData);
        repoFullName = prData.repository.full_name;
        break;
      }
      case 'push': {
        const pushData = data as PushEvent;
        prompt = formatPushAsPrompt(pushData);
        repoFullName = pushData.repository.full_name;
        break;
      }
      default:
        return {
          success: false,
          message: `Unsupported event type: ${event}`,
        };
    }

    const agent = await this.config.getAgentByRepository(repoFullName);

    if (!agent) {
      return {
        success: false,
        message: `No agent configured for repository: ${repoFullName}`,
      };
    }

    try {
      const client = createOpenCodeClient({
        hostname: agent.ec2PublicIp,
        port: 4096,
        username: 'opencode',
        password: agent.opencodePassword,
      });

      const health = await client.healthCheck();
      if (!health.healthy) {
        return {
          success: false,
          message: 'Agent is not healthy',
        };
      }

      const session = await client.createSession({
        title: `${event}: ${repoFullName}`,
      });

      if (this.config.onSessionCreated) {
        await this.config.onSessionCreated(session.id, agent.id);
      }

      const response = await client.sendMessage(session.id, prompt, {
        system: `You are an AI coding assistant working on GitHub. Your role is to help with code reviews, address issues, and implement features. You have access to the repository and can make commits and pull requests using your GitHub identity. Be helpful, professional, and thorough in your responses.`,
      });

      if (response.tokenUsage && this.config.onTokenUsage) {
        await this.config.onTokenUsage(agent.id, {
          model: response.tokenUsage.model,
          inputTokens: response.tokenUsage.inputTokens,
          outputTokens: response.tokenUsage.outputTokens,
          costUSD: this.calculateCost(
            response.tokenUsage.model,
            response.tokenUsage.inputTokens,
            response.tokenUsage.outputTokens,
          ),
        });
      }

      const responseText = this.extractTextFromParts(response.parts);

      return {
        success: true,
        message: 'Webhook processed successfully',
        sessionId: session.id,
        response: responseText,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error processing webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const costs: Record<string, { input: number; output: number }> = {
      'anthropic/claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
      'anthropic/claude-opus-4-20250514': { input: 15.0, output: 75.0 },
      'anthropic/claude-haiku-3-20250514': { input: 0.8, output: 4.0 },
    };

    const modelCosts = costs[model] || { input: 3.0, output: 15.0 };
    return (
      (inputTokens / 1_000_000) * modelCosts.input +
      (outputTokens / 1_000_000) * modelCosts.output
    );
  }

  private extractTextFromParts(parts: unknown[]): string {
    const textParts: string[] = [];

    for (const part of parts) {
      if (part && typeof part === 'object' && 'type' in part) {
        const p = part as { type: string; content?: string; text?: string };
        if (p.type === 'text' || p.type === 'message') {
          textParts.push(p.content || p.text || '');
        }
      }
    }

    return textParts.join('\n');
  }
}

export function createGitHubWebhookHandler(
  config: GitHubWebhookHandlerConfig,
): GitHubWebhookHandler {
  return new GitHubWebhookHandler(config);
}
