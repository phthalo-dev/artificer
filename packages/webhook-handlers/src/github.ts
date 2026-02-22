import { createHmac } from 'crypto';
import { z } from 'zod';

export const GITHUB_EVENT_TYPES = [
  'issue_comment',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'push',
  'check_run',
  'check_suite',
] as const;

export type GitHubEventType = (typeof GITHUB_EVENT_TYPES)[number];

export interface GitHubWebhookPayload {
  event: GitHubEventType;
  payload: unknown;
  signature?: string;
  delivery?: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  git_url: string;
  ssh_url: string;
  owner: {
    login: string;
    id: number;
  };
}

export const IssueCommentPayloadSchema = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string(),
    state: z.enum(['open', 'closed']),
    user: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }),
  comment: z.object({
    id: z.number(),
    body: z.string(),
    html_url: z.string(),
    user: z.object({
      login: z.string(),
      id: z.number(),
    }),
    created_at: z.string(),
  }),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    html_url: z.string(),
    clone_url: z.string(),
    git_url: z.string(),
    ssh_url: z.string(),
    owner: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }),
  sender: z.object({
    login: z.string(),
    id: z.number(),
  }),
});

export const PullRequestPayloadSchema = z.object({
  action: z.string(),
  number: z.number(),
  pull_request: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    state: z.enum(['open', 'closed']),
    html_url: z.string(),
    head: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    base: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    user: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    html_url: z.string(),
    clone_url: z.string(),
    git_url: z.string(),
    ssh_url: z.string(),
    owner: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }),
  sender: z.object({
    login: z.string(),
    id: z.number(),
  }),
});

export const PushEventSchema = z.object({
  ref: z.string(),
  before: z.string(),
  after: z.string(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    html_url: z.string(),
    clone_url: z.string(),
    git_url: z.string(),
    ssh_url: z.string(),
    owner: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }),
  pusher: z.object({
    name: z.string(),
    email: z.string().nullable(),
  }),
  commits: z.array(
    z.object({
      id: z.string(),
      message: z.string(),
      timestamp: z.string(),
      author: z.object({
        name: z.string(),
        email: z.string().nullable(),
        username: z.string(),
      }),
      added: z.array(z.string()),
      removed: z.array(z.string()),
      modified: z.array(z.string()),
    }),
  ),
});

export type IssueCommentPayload = z.infer<typeof IssueCommentPayloadSchema>;
export type PullRequestPayload = z.infer<typeof PullRequestPayloadSchema>;
export type PushEvent = z.infer<typeof PushEventSchema>;

export function verifyGitHubSignature(
  payload: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    return false;
  }

  const hmac = createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  return signature === digest;
}

export function parseGitHubEvent(
  eventType: string | undefined,
  payload: unknown,
): {
  event: GitHubEventType;
  data: IssueCommentPayload | PullRequestPayload | PushEvent | null;
} {
  if (
    !eventType ||
    !GITHUB_EVENT_TYPES.includes(eventType as GitHubEventType)
  ) {
    return { event: 'issue_comment', data: null };
  }

  const event = eventType as GitHubEventType;

  switch (event) {
    case 'issue_comment': {
      const parsed = IssueCommentPayloadSchema.safeParse(payload);
      return {
        event,
        data: parsed.success ? parsed.data : null,
      };
    }
    case 'pull_request':
    case 'pull_request_review':
    case 'pull_request_review_comment': {
      const parsed = PullRequestPayloadSchema.safeParse(payload);
      return {
        event,
        data: parsed.success ? parsed.data : null,
      };
    }
    case 'push': {
      const parsed = PushEventSchema.safeParse(payload);
      return {
        event,
        data: parsed.success ? parsed.data : null,
      };
    }
    default:
      return { event, data: null };
  }
}

export function formatIssueCommentAsPrompt(
  payload: IssueCommentPayload,
): string {
  const { action, issue, comment, repository } = payload;

  let prompt = `New comment on GitHub issue #${issue.number}: "${issue.title}"\n`;
  prompt += `Repository: ${repository.full_name}\n`;
  prompt += `Comment by: @${comment.user.login}\n`;
  prompt += `Comment: ${comment.body}\n\n`;

  if (action === 'created') {
    prompt += `Please analyze this comment and help address any questions or tasks mentioned.`;
  }

  return prompt;
}

export function formatPullRequestAsPrompt(payload: PullRequestPayload): string {
  const { action, pull_request, repository } = payload;

  let prompt = `Pull Request #${pull_request.number}: "${pull_request.title}"\n`;
  prompt += `Repository: ${repository.full_name}\n`;
  prompt += `Action: ${action}\n`;
  prompt += `Branch: ${pull_request.head.ref} -> ${pull_request.base.ref}\n`;
  prompt += `Author: @${pull_request.user.login}\n`;

  if (pull_request.body) {
    prompt += `\nDescription:\n${pull_request.body}\n`;
  }

  if (action === 'opened') {
    prompt += `\nPlease review this PR and provide feedback, or help implement any changes requested.`;
  } else if (action === 'synchronize') {
    prompt += `\nNew commits have been pushed. Please review the changes.`;
  }

  return prompt;
}

export function formatPushAsPrompt(payload: PushEvent): string {
  const { repository, commits, pusher, ref } = payload;

  const branch = ref.replace('refs/heads/', '');

  let prompt = `New push to ${repository.full_name} on branch ${branch}\n`;
  prompt += `Pushed by: ${pusher.name}\n`;
  prompt += `\nCommits:\n`;

  for (const commit of commits) {
    prompt += `\n- ${commit.id.slice(0, 7)}: ${commit.message}\n`;
    prompt += `  Author: ${commit.author.name} <${commit.author.email}>\n`;
    if (commit.added.length > 0) {
      prompt += `  Added: ${commit.added.join(', ')}\n`;
    }
    if (commit.modified.length > 0) {
      prompt += `  Modified: ${commit.modified.join(', ')}\n`;
    }
    if (commit.removed.length > 0) {
      prompt += `  Removed: ${commit.removed.join(', ')}\n`;
    }
  }

  prompt += `\nPlease review these changes and provide feedback if needed.`;

  return prompt;
}
