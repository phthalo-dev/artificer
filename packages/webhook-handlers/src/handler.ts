import { createOpenCodeClient } from '@artificer/opencode-client';
import {
  verifyGitHubSignature,
  parseGitHubEvent,
  shouldHandleIssueComment,
  shouldHandleIssue,
  shouldHandlePullRequest,
  shouldHandlePRReview,
  shouldHandlePRReviewComment,
  formatIssueCommentAsPrompt,
  formatIssueAsPrompt,
  formatPullRequestAsPrompt,
  formatPRReviewAsPrompt,
  formatPRReviewCommentAsPrompt,
  formatPushAsPrompt,
  postGitHubComment,
  postGitHubPRComment,
  type IssueCommentPayload,
  type IssuePayload,
  type PullRequestPayload,
  type PullRequestReviewPayload,
  type PullRequestReviewCommentPayload,
  type PushEvent,
} from './github';

export interface AgentInfo {
  id: string;
  /** The agent's GitHub username — used to detect @mentions and avoid self-replies */
  githubUsername: string;
  /** Decrypted GitHub token — used to post comments back to GitHub */
  githubToken: string;
  ec2PublicIp: string;
  opencodePassword: string;
}

export interface GitHubWebhookHandlerConfig {
  webhookSecret: string;
  getAgentByRepository: (repoFullName: string) => Promise<AgentInfo | null>;
  onSessionCreated?: (
    sessionId: string,
    agentId: string,
    source: 'GITHUB',
  ) => Promise<void>;
  onTokenUsage?: (
    agentId: string,
    usage: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number;
    },
  ) => Promise<void>;
  onActivity?: (
    agentId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
}

export interface WebhookResult {
  success: boolean;
  message: string;
  sessionId?: string;
  response?: string;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const AGENT_SYSTEM_PROMPT = `You are an autonomous AI coding agent working on GitHub. You have shell access to a Linux environment where you can run git, gh (GitHub CLI), and other tools.

Your responsibilities:
- Implement features and bug fixes from GitHub issues
- Address pull request review feedback
- Write clean, well-tested code
- Follow existing project conventions

When you finish your work, provide a concise summary of:
1. What you changed and why
2. Any commands you ran (e.g. branch created, PR opened)
3. Any important decisions or tradeoffs

This summary will be posted back to GitHub as a comment.`;

// ---------------------------------------------------------------------------
// Handler class
// ---------------------------------------------------------------------------

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
    // 1. Verify signature
    if (
      !verifyGitHubSignature(
        payloadString,
        signature,
        this.config.webhookSecret,
      )
    ) {
      return { success: false, message: 'Invalid signature' };
    }

    // 2. Parse payload
    const payload = JSON.parse(payloadString);
    const parsed = parseGitHubEvent(eventType, payload);

    if (!parsed.data) {
      return {
        success: false,
        message: `Unable to parse webhook payload for event: ${eventType}`,
      };
    }

    // 3. Route the event
    return this.routeEvent(parsed);
  }

  private async routeEvent(
    parsed: ReturnType<typeof parseGitHubEvent>,
  ): Promise<WebhookResult> {
    if (!parsed.data) {
      return { success: false, message: 'No parsed data' };
    }

    // Determine the repository full name from whichever payload shape we have
    const repoFullName = this.extractRepoFullName(parsed.data);

    const agent = await this.config.getAgentByRepository(repoFullName);
    if (!agent) {
      return {
        success: false,
        message: `No agent configured for repository: ${repoFullName}`,
      };
    }

    const { event } = parsed;

    switch (event) {
      case 'issue_comment': {
        const data = parsed.data as IssueCommentPayload;
        if (!shouldHandleIssueComment(data, agent.githubUsername)) {
          return {
            success: true,
            message: `Ignoring issue_comment: action=${data.action}, no mention of @${agent.githubUsername}`,
          };
        }
        const prompt = formatIssueCommentAsPrompt(data, agent.githubUsername);
        const sessionTitle = `issue_comment: ${data.issue.title} (#${data.issue.number})`;
        const commentTargetNumber = data.issue.number;
        return this.dispatchToAgent(
          agent,
          prompt,
          sessionTitle,
          async (_placeholder) => {
            await postGitHubComment({
              token: agent.githubToken,
              repoFullName,
              issueOrPrNumber: commentTargetNumber,
              body: this.formatStartComment(agent.githubUsername),
            });
          },
          async (response) => {
            if (response) {
              await postGitHubComment({
                token: agent.githubToken,
                repoFullName,
                issueOrPrNumber: commentTargetNumber,
                body: this.formatCompletionComment(
                  response,
                  agent.githubUsername,
                ),
              });
            }
          },
        );
      }

      case 'issues': {
        const data = parsed.data as IssuePayload;
        if (!shouldHandleIssue(data, agent.githubUsername)) {
          return {
            success: true,
            message: `Ignoring issues event: action=${data.action}, not targeting @${agent.githubUsername}`,
          };
        }
        const prompt = formatIssueAsPrompt(data, agent.githubUsername);
        const sessionTitle = `issue: ${data.issue.title} (#${data.issue.number})`;
        return this.dispatchToAgent(
          agent,
          prompt,
          sessionTitle,
          async (_response) => {
            await postGitHubComment({
              token: agent.githubToken,
              repoFullName,
              issueOrPrNumber: data.issue.number,
              body: this.formatStartComment(agent.githubUsername),
            });
          },
          async (response) => {
            if (response) {
              await postGitHubComment({
                token: agent.githubToken,
                repoFullName,
                issueOrPrNumber: data.issue.number,
                body: this.formatCompletionComment(
                  response,
                  agent.githubUsername,
                ),
              });
            }
          },
        );
      }

      case 'pull_request': {
        const data = parsed.data as PullRequestPayload;
        if (!shouldHandlePullRequest(data, agent.githubUsername)) {
          return {
            success: true,
            message: `Ignoring pull_request event: action=${data.action}, not targeting @${agent.githubUsername}`,
          };
        }
        const prompt = formatPullRequestAsPrompt(data, agent.githubUsername);
        const sessionTitle = `pull_request: ${data.pull_request.title} (#${data.pull_request.number})`;
        return this.dispatchToAgent(
          agent,
          prompt,
          sessionTitle,
          async (_response) => {
            await postGitHubPRComment({
              token: agent.githubToken,
              repoFullName,
              prNumber: data.pull_request.number,
              body: this.formatStartComment(agent.githubUsername),
            });
          },
          async (response) => {
            if (response) {
              await postGitHubPRComment({
                token: agent.githubToken,
                repoFullName,
                prNumber: data.pull_request.number,
                body: this.formatCompletionComment(
                  response,
                  agent.githubUsername,
                ),
              });
            }
          },
        );
      }

      case 'pull_request_review': {
        const data = parsed.data as PullRequestReviewPayload;
        if (!shouldHandlePRReview(data, agent.githubUsername)) {
          return {
            success: true,
            message: `Ignoring pull_request_review: action=${data.action}, state=${data.review.state}`,
          };
        }
        const prompt = formatPRReviewAsPrompt(data, agent.githubUsername);
        const sessionTitle = `pr_review: ${data.pull_request.title} (#${data.pull_request.number})`;
        return this.dispatchToAgent(
          agent,
          prompt,
          sessionTitle,
          async (_response) => {
            await postGitHubPRComment({
              token: agent.githubToken,
              repoFullName,
              prNumber: data.pull_request.number,
              body: this.formatStartComment(agent.githubUsername),
            });
          },
          async (response) => {
            if (response) {
              await postGitHubPRComment({
                token: agent.githubToken,
                repoFullName,
                prNumber: data.pull_request.number,
                body: this.formatCompletionComment(
                  response,
                  agent.githubUsername,
                ),
              });
            }
          },
        );
      }

      case 'pull_request_review_comment': {
        const data = parsed.data as PullRequestReviewCommentPayload;
        if (!shouldHandlePRReviewComment(data, agent.githubUsername)) {
          return {
            success: true,
            message: `Ignoring pull_request_review_comment: no mention of @${agent.githubUsername}`,
          };
        }
        const prompt = formatPRReviewCommentAsPrompt(
          data,
          agent.githubUsername,
        );
        const sessionTitle = `pr_review_comment: ${data.pull_request.title} (#${data.pull_request.number})`;
        return this.dispatchToAgent(
          agent,
          prompt,
          sessionTitle,
          async (_response) => {
            await postGitHubPRComment({
              token: agent.githubToken,
              repoFullName,
              prNumber: data.pull_request.number,
              body: this.formatStartComment(agent.githubUsername),
            });
          },
          async (response) => {
            if (response) {
              await postGitHubPRComment({
                token: agent.githubToken,
                repoFullName,
                prNumber: data.pull_request.number,
                body: this.formatCompletionComment(
                  response,
                  agent.githubUsername,
                ),
              });
            }
          },
        );
      }

      case 'push': {
        const data = parsed.data as PushEvent;
        const prompt = formatPushAsPrompt(data);
        const branch = data.ref.replace('refs/heads/', '');
        const sessionTitle = `push: ${repoFullName} (${branch})`;
        return this.dispatchToAgent(agent, prompt, sessionTitle);
      }

      default:
        return {
          success: false,
          message: `Unsupported event type: ${event}`,
        };
    }
  }

  // ---------------------------------------------------------------------------
  // Core dispatch: create session, post start comment, send prompt, post result
  // ---------------------------------------------------------------------------

  private async dispatchToAgent(
    agent: AgentInfo,
    prompt: string,
    sessionTitle: string,
    onBeforeSend?: (placeholder: null) => Promise<void>,
    onAfterSend?: (response: string | null) => Promise<void>,
  ): Promise<WebhookResult> {
    try {
      const client = createOpenCodeClient({
        hostname: agent.ec2PublicIp,
        port: 4096,
        username: 'opencode',
        password: agent.opencodePassword,
      });

      const health = await client.healthCheck();
      if (!health.healthy) {
        return { success: false, message: 'Agent is not healthy' };
      }

      const session = await client.createSession({ title: sessionTitle });

      if (this.config.onSessionCreated) {
        await this.config.onSessionCreated(session.id, agent.id, 'GITHUB');
      }

      // Post "starting work" comment before we send the prompt (fire-and-forget)
      if (onBeforeSend) {
        await onBeforeSend(null).catch((err) =>
          console.error('Failed to post start comment:', err),
        );
      }

      const response = await client.sendMessage(session.id, prompt, {
        system: AGENT_SYSTEM_PROMPT,
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

      if (onAfterSend) {
        await onAfterSend(responseText || null).catch((err) =>
          console.error('Failed to post completion comment:', err),
        );
      }

      if (this.config.onActivity) {
        await this.config
          .onActivity(
            agent.id,
            'CODE_CHANGE',
            `Processed GitHub event: ${sessionTitle}`,
            { sessionId: session.id },
          )
          .catch((err) => console.error('Failed to log activity:', err));
      }

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

  // ---------------------------------------------------------------------------
  // Comment body templates
  // ---------------------------------------------------------------------------

  private formatStartComment(username: string): string {
    return `> [!NOTE]\n> **@${username}** is on it — picking up this task now. I'll update this thread when I'm done.`;
  }

  private formatCompletionComment(response: string, username: string): string {
    const summary =
      response.length > 3000
        ? response.slice(0, 3000) +
          '\n\n_...truncated. See the full session in Artificer._'
        : response;

    return `> [!NOTE]\n> **@${username}** finished working on this.\n\n${summary}`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractRepoFullName(data: unknown): string {
    if (
      data &&
      typeof data === 'object' &&
      'repository' in data &&
      data.repository &&
      typeof data.repository === 'object' &&
      'full_name' in data.repository
    ) {
      return (data.repository as { full_name: string }).full_name;
    }
    return 'unknown/unknown';
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
