import type { WorkDispatcher } from '@artificer/agent-gateway';
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
}

export interface GitHubWebhookHandlerConfig {
  webhookSecret: string;
  workDispatcher: WorkDispatcher;
  getAgentByRepository: (repoFullName: string) => Promise<AgentInfo | null>;
  onWorkDispatched?: (
    agentId: string,
    source: 'GITHUB',
    metadata: Record<string, unknown>,
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
      return { success: false, message: 'Invalid signature' };
    }

    const payload = JSON.parse(payloadString);
    const parsed = parseGitHubEvent(eventType, payload);

    if (!parsed.data) {
      return {
        success: false,
        message: `Unable to parse webhook payload for event: ${eventType}`,
      };
    }

    return this.routeEvent(parsed);
  }

  private async routeEvent(
    parsed: ReturnType<typeof parseGitHubEvent>,
  ): Promise<WebhookResult> {
    if (!parsed.data) {
      return { success: false, message: 'No parsed data' };
    }

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
        return this.dispatchGitHubWork(agent, prompt, repoFullName, {
          event: 'issue_comment',
          issueNumber: data.issue.number,
          isPullRequest: !!data.issue.pull_request,
        }, async () => {
          await postGitHubComment({
            token: agent.githubToken,
            repoFullName,
            issueOrPrNumber: data.issue.number,
            body: this.formatStartComment(agent.githubUsername),
          });
        });
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
        return this.dispatchGitHubWork(agent, prompt, repoFullName, {
          event: 'issues',
          issueNumber: data.issue.number,
          action: data.action,
        }, async () => {
          await postGitHubComment({
            token: agent.githubToken,
            repoFullName,
            issueOrPrNumber: data.issue.number,
            body: this.formatStartComment(agent.githubUsername),
          });
        });
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
        return this.dispatchGitHubWork(agent, prompt, repoFullName, {
          event: 'pull_request',
          pullRequestNumber: data.pull_request.number,
          action: data.action,
        }, async () => {
          await postGitHubPRComment({
            token: agent.githubToken,
            repoFullName,
            prNumber: data.pull_request.number,
            body: this.formatStartComment(agent.githubUsername),
          });
        });
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
        return this.dispatchGitHubWork(agent, prompt, repoFullName, {
          event: 'pull_request_review',
          pullRequestNumber: data.pull_request.number,
        }, async () => {
          await postGitHubPRComment({
            token: agent.githubToken,
            repoFullName,
            prNumber: data.pull_request.number,
            body: this.formatStartComment(agent.githubUsername),
          });
        });
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
        return this.dispatchGitHubWork(agent, prompt, repoFullName, {
          event: 'pull_request_review_comment',
          pullRequestNumber: data.pull_request.number,
        }, async () => {
          await postGitHubPRComment({
            token: agent.githubToken,
            repoFullName,
            prNumber: data.pull_request.number,
            body: this.formatStartComment(agent.githubUsername),
          });
        });
      }

      case 'push': {
        const data = parsed.data as PushEvent;
        const prompt = formatPushAsPrompt(data);
        const branch = data.ref.replace('refs/heads/', '');
        return this.dispatchGitHubWork(agent, prompt, repoFullName, {
          event: 'push',
          branch,
        });
      }

      default:
        return {
          success: false,
          message: `Unsupported event type: ${event}`,
        };
    }
  }

  private async dispatchGitHubWork(
    agent: AgentInfo,
    prompt: string,
    repoFullName: string,
    metadata: Record<string, unknown>,
    onBeforeDispatch?: () => Promise<void>,
  ): Promise<WebhookResult> {
    try {
      if (onBeforeDispatch) {
        await onBeforeDispatch().catch((err) =>
          console.error('Failed to post start comment:', err),
        );
      }

      const result = await this.config.workDispatcher.dispatch({
        source: 'github',
        content: prompt,
        metadata: { repo: repoFullName, ...metadata },
      });

      if (this.config.onWorkDispatched) {
        await this.config
          .onWorkDispatched(agent.id, 'GITHUB', metadata)
          .catch((err) => console.error('onWorkDispatched failed:', err));
      }

      if (this.config.onActivity) {
        await this.config
          .onActivity(
            agent.id,
            'GITHUB_EVENT',
            `Queued GitHub work for ${repoFullName}`,
            metadata,
          )
          .catch((err) => console.error('onActivity failed:', err));
      }

      return {
        success: result.accepted,
        message: result.message,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error dispatching work: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private formatStartComment(username: string): string {
    return `> [!NOTE]\n> **@${username}** is on it — picking up this task now. I'll update this thread when I'm done.`;
  }

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
}

export function createGitHubWebhookHandler(
  config: GitHubWebhookHandlerConfig,
): GitHubWebhookHandler {
  return new GitHubWebhookHandler(config);
}
