import { createHmac } from 'crypto';
import { z } from 'zod';

export const GITHUB_EVENT_TYPES = [
  'issue_comment',
  'issues',
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

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const RepositorySchema = z.object({
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
});

const UserSchema = z.object({
  login: z.string(),
  id: z.number(),
});

const LabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  description: z.string().nullable().optional(),
});

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

// ---------------------------------------------------------------------------
// Issue comment event
// ---------------------------------------------------------------------------

export const IssueCommentPayloadSchema = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string(),
    state: z.enum(['open', 'closed']),
    user: UserSchema,
    labels: z.array(LabelSchema).optional().default([]),
    assignees: z.array(UserSchema).optional().default([]),
    pull_request: z
      .object({
        url: z.string(),
        html_url: z.string(),
        merged_at: z.string().nullable().optional(),
      })
      .optional(),
  }),
  comment: z.object({
    id: z.number(),
    body: z.string(),
    html_url: z.string(),
    user: UserSchema,
    created_at: z.string(),
  }),
  repository: RepositorySchema,
  sender: UserSchema,
});

// ---------------------------------------------------------------------------
// Issues event (opened, assigned, labeled, etc.)
// ---------------------------------------------------------------------------

export const IssuePayloadSchema = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string(),
    state: z.enum(['open', 'closed']),
    user: UserSchema,
    labels: z.array(LabelSchema).optional().default([]),
    assignees: z.array(UserSchema).optional().default([]),
  }),
  assignee: UserSchema.optional(), // populated for "assigned" action
  label: LabelSchema.optional(), // populated for "labeled" action
  repository: RepositorySchema,
  sender: UserSchema,
});

// ---------------------------------------------------------------------------
// Pull request event
// ---------------------------------------------------------------------------

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
    user: UserSchema,
    draft: z.boolean().optional().default(false),
    labels: z.array(LabelSchema).optional().default([]),
    requested_reviewers: z.array(UserSchema).optional().default([]),
  }),
  repository: RepositorySchema,
  sender: UserSchema,
});

// ---------------------------------------------------------------------------
// Pull request review event
// ---------------------------------------------------------------------------

export const PullRequestReviewPayloadSchema = z.object({
  action: z.string(),
  review: z.object({
    id: z.number(),
    body: z.string().nullable(),
    html_url: z.string(),
    state: z.enum(['approved', 'changes_requested', 'commented', 'dismissed']),
    user: UserSchema,
    submitted_at: z.string(),
  }),
  pull_request: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string(),
    head: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    base: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    user: UserSchema,
  }),
  repository: RepositorySchema,
  sender: UserSchema,
});

// ---------------------------------------------------------------------------
// Pull request review comment event
// ---------------------------------------------------------------------------

export const PullRequestReviewCommentPayloadSchema = z.object({
  action: z.string(),
  comment: z.object({
    id: z.number(),
    body: z.string(),
    html_url: z.string(),
    user: UserSchema,
    path: z.string(), // file path the comment is on
    position: z.number().nullable().optional(),
    line: z.number().nullable().optional(),
    diff_hunk: z.string().optional(), // the diff context around the comment
    created_at: z.string(),
  }),
  pull_request: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string(),
    head: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    base: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    user: UserSchema,
  }),
  repository: RepositorySchema,
  sender: UserSchema,
});

// ---------------------------------------------------------------------------
// Push event
// ---------------------------------------------------------------------------

export const PushEventSchema = z.object({
  ref: z.string(),
  before: z.string(),
  after: z.string(),
  repository: RepositorySchema,
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

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type IssueCommentPayload = z.infer<typeof IssueCommentPayloadSchema>;
export type IssuePayload = z.infer<typeof IssuePayloadSchema>;
export type PullRequestPayload = z.infer<typeof PullRequestPayloadSchema>;
export type PullRequestReviewPayload = z.infer<
  typeof PullRequestReviewPayloadSchema
>;
export type PullRequestReviewCommentPayload = z.infer<
  typeof PullRequestReviewCommentPayloadSchema
>;
export type PushEvent = z.infer<typeof PushEventSchema>;

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

export type ParsedGitHubEvent =
  | { event: 'issue_comment'; data: IssueCommentPayload }
  | { event: 'issues'; data: IssuePayload }
  | { event: 'pull_request'; data: PullRequestPayload }
  | { event: 'pull_request_review'; data: PullRequestReviewPayload }
  | {
      event: 'pull_request_review_comment';
      data: PullRequestReviewCommentPayload;
    }
  | { event: 'push'; data: PushEvent }
  | { event: GitHubEventType; data: null };

export function parseGitHubEvent(
  eventType: string | undefined,
  payload: unknown,
): ParsedGitHubEvent {
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
      return parsed.success
        ? { event, data: parsed.data }
        : { event, data: null };
    }
    case 'issues': {
      const parsed = IssuePayloadSchema.safeParse(payload);
      return parsed.success
        ? { event, data: parsed.data }
        : { event, data: null };
    }
    case 'pull_request': {
      const parsed = PullRequestPayloadSchema.safeParse(payload);
      return parsed.success
        ? { event, data: parsed.data }
        : { event, data: null };
    }
    case 'pull_request_review': {
      const parsed = PullRequestReviewPayloadSchema.safeParse(payload);
      return parsed.success
        ? { event, data: parsed.data }
        : { event, data: null };
    }
    case 'pull_request_review_comment': {
      const parsed = PullRequestReviewCommentPayloadSchema.safeParse(payload);
      return parsed.success
        ? { event, data: parsed.data }
        : { event, data: null };
    }
    case 'push': {
      const parsed = PushEventSchema.safeParse(payload);
      return parsed.success
        ? { event, data: parsed.data }
        : { event, data: null };
    }
    default:
      return { event, data: null };
  }
}

// ---------------------------------------------------------------------------
// Mention detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the given GitHub username is @mentioned in the text.
 * Matches @username at word boundaries (case-insensitive).
 */
export function isMentioned(
  text: string | null | undefined,
  username: string,
): boolean {
  if (!text) return false;
  const pattern = new RegExp(`@${escapeRegex(username)}\\b`, 'i');
  return pattern.test(text);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check whether this issue_comment event should be acted on:
 *  - comment is "created"
 *  - the commenter is NOT the agent itself (avoid feedback loops)
 *  - the agent's username is @mentioned in the comment body
 */
export function shouldHandleIssueComment(
  payload: IssueCommentPayload,
  agentUsername: string,
): boolean {
  if (payload.action !== 'created') return false;
  if (payload.comment.user.login.toLowerCase() === agentUsername.toLowerCase())
    return false;
  return isMentioned(payload.comment.body, agentUsername);
}

/**
 * Check whether this issues event should be acted on:
 *  - action is "assigned" and assignee is the agent
 *  - OR action is "opened" / "reopened" and agent is @mentioned in the body
 */
export function shouldHandleIssue(
  payload: IssuePayload,
  agentUsername: string,
): boolean {
  if (payload.action === 'assigned') {
    return (
      payload.assignee?.login?.toLowerCase() === agentUsername.toLowerCase() ||
      payload.issue.assignees.some(
        (a) => a.login.toLowerCase() === agentUsername.toLowerCase(),
      )
    );
  }
  if (payload.action === 'opened' || payload.action === 'reopened') {
    return isMentioned(payload.issue.body, agentUsername);
  }
  return false;
}

/**
 * Check whether this pull_request event should be acted on:
 *  - action is "opened" / "synchronize" / "reopened"
 *  - agent is @mentioned in the PR body OR is a requested reviewer
 */
export function shouldHandlePullRequest(
  payload: PullRequestPayload,
  agentUsername: string,
): boolean {
  const allowedActions = ['opened', 'synchronize', 'reopened'];
  if (!allowedActions.includes(payload.action)) return false;
  if (payload.pull_request.draft) return false;

  const mentionedInBody = isMentioned(payload.pull_request.body, agentUsername);
  const isRequestedReviewer = payload.pull_request.requested_reviewers.some(
    (r) => r.login.toLowerCase() === agentUsername.toLowerCase(),
  );
  return mentionedInBody || isRequestedReviewer;
}

/**
 * Check whether this pull_request_review event should trigger the agent:
 *  - action is "submitted"
 *  - review state is "changes_requested" (the primary feedback scenario)
 *  - reviewer is NOT the agent itself
 *  - (optionally) agent is @mentioned in the review body
 *
 * We act on all `changes_requested` reviews so the agent can address ALL
 * requested changes, not only ones that explicitly @mention it.
 */
export function shouldHandlePRReview(
  payload: PullRequestReviewPayload,
  agentUsername: string,
): boolean {
  if (payload.action !== 'submitted') return false;
  if (payload.review.user.login.toLowerCase() === agentUsername.toLowerCase())
    return false;
  return payload.review.state === 'changes_requested';
}

/**
 * Check whether this pull_request_review_comment event should trigger the agent:
 *  - action is "created"
 *  - commenter is NOT the agent itself
 *  - agent is @mentioned in the comment body
 */
export function shouldHandlePRReviewComment(
  payload: PullRequestReviewCommentPayload,
  agentUsername: string,
): boolean {
  if (payload.action !== 'created') return false;
  if (payload.comment.user.login.toLowerCase() === agentUsername.toLowerCase())
    return false;
  return isMentioned(payload.comment.body, agentUsername);
}

// ---------------------------------------------------------------------------
// Prompt formatters
// ---------------------------------------------------------------------------

export function formatIssueCommentAsPrompt(
  payload: IssueCommentPayload,
  agentUsername: string,
): string {
  const { issue, comment, repository } = payload;

  const isPR = !!issue.pull_request;
  const contextType = isPR ? 'pull request' : 'issue';

  let prompt = `You have been mentioned in a GitHub ${contextType} comment and need to respond.\n\n`;
  prompt += `## Repository\n${repository.full_name} (${repository.html_url})\n\n`;
  prompt += `## ${isPR ? 'Pull Request' : 'Issue'} #${issue.number}: ${issue.title}\n`;
  prompt += `URL: ${issue.html_url}\n`;
  prompt += `State: ${issue.state}\n`;

  if (issue.labels.length > 0) {
    prompt += `Labels: ${issue.labels.map((l) => l.name).join(', ')}\n`;
  }
  if (issue.assignees.length > 0) {
    prompt += `Assignees: ${issue.assignees.map((a) => `@${a.login}`).join(', ')}\n`;
  }

  if (issue.body) {
    prompt += `\n### Description\n${issue.body}\n`;
  }

  prompt += `\n## Comment by @${comment.user.login}\n`;
  prompt += `${comment.body}\n\n`;

  prompt += `## Your Task\n`;
  prompt += `@${agentUsername} has been mentioned. Please:\n`;
  prompt += `1. Read the ${contextType} description and comment carefully.\n`;
  prompt += `2. Implement any code changes requested or answer the question.\n`;
  prompt += `3. If you make code changes, commit them with a descriptive message and push to the appropriate branch.\n`;
  prompt += `4. Reply with a summary of what you did (this will be posted as a GitHub comment).\n`;

  return prompt;
}

export function formatIssueAsPrompt(
  payload: IssuePayload,
  agentUsername: string,
): string {
  const { issue, repository, action } = payload;

  let prompt = '';

  if (action === 'assigned') {
    prompt += `You have been assigned a GitHub issue and need to implement it.\n\n`;
  } else {
    prompt += `You have been mentioned in a GitHub issue and need to address it.\n\n`;
  }

  prompt += `## Repository\n${repository.full_name} (${repository.html_url})\n\n`;
  prompt += `## Issue #${issue.number}: ${issue.title}\n`;
  prompt += `URL: ${issue.html_url}\n`;
  prompt += `State: ${issue.state}\n`;
  prompt += `Author: @${issue.user.login}\n`;

  if (issue.labels.length > 0) {
    prompt += `Labels: ${issue.labels.map((l) => l.name).join(', ')}\n`;
  }
  if (issue.assignees.length > 0) {
    prompt += `Assignees: ${issue.assignees.map((a) => `@${a.login}`).join(', ')}\n`;
  }

  if (issue.body) {
    prompt += `\n### Issue Description\n${issue.body}\n`;
  }

  prompt += `\n## Your Task\n`;
  prompt += `As @${agentUsername}, please:\n`;
  prompt += `1. Clone/pull the repository if not already present locally.\n`;
  prompt += `2. Create a new branch named \`agent/${issue.number}-${slugify(issue.title)}\`.\n`;
  prompt += `3. Implement the changes requested in the issue.\n`;
  prompt += `4. Write tests if appropriate.\n`;
  prompt += `5. Commit your changes with descriptive commit messages.\n`;
  prompt += `6. Push the branch to the remote.\n`;
  prompt += `7. Open a pull request with a summary of your changes.\n`;
  prompt += `8. Reply with a summary of what you did (this will be posted as a GitHub comment on the issue).\n`;

  return prompt;
}

export function formatPullRequestAsPrompt(
  payload: PullRequestPayload,
  agentUsername: string,
): string {
  const { action, pull_request, repository } = payload;

  let prompt = '';

  if (action === 'opened') {
    prompt += `You have been requested to review a pull request.\n\n`;
  } else {
    prompt += `A pull request has been updated with new commits and needs your attention.\n\n`;
  }

  prompt += `## Repository\n${repository.full_name} (${repository.html_url})\n\n`;
  prompt += `## Pull Request #${pull_request.number}: ${pull_request.title}\n`;
  prompt += `URL: ${pull_request.html_url}\n`;
  prompt += `State: ${pull_request.state}\n`;
  prompt += `Author: @${pull_request.user.login}\n`;
  prompt += `Branch: \`${pull_request.head.ref}\` → \`${pull_request.base.ref}\`\n`;
  prompt += `Head SHA: ${pull_request.head.sha}\n`;

  if (pull_request.labels.length > 0) {
    prompt += `Labels: ${pull_request.labels.map((l) => l.name).join(', ')}\n`;
  }

  if (pull_request.body) {
    prompt += `\n### Description\n${pull_request.body}\n`;
  }

  prompt += `\n## Your Task\n`;
  prompt += `As @${agentUsername}, please:\n`;

  if (action === 'opened') {
    prompt += `1. Check out the branch \`${pull_request.head.ref}\` locally.\n`;
    prompt += `2. Review the code changes (run \`git diff ${pull_request.base.ref}...${pull_request.head.ref}\`).\n`;
    prompt += `3. If you find issues, push fixes to the same branch \`${pull_request.head.ref}\`.\n`;
    prompt += `4. Reply with a summary of your review and any changes made.\n`;
  } else {
    prompt += `1. Pull the latest changes for branch \`${pull_request.head.ref}\`.\n`;
    prompt += `2. Review the new commits and ensure everything looks good.\n`;
    prompt += `3. If there are outstanding review comments to address, fix them.\n`;
    prompt += `4. Reply with a summary of what you reviewed/changed.\n`;
  }

  return prompt;
}

export function formatPRReviewAsPrompt(
  payload: PullRequestReviewPayload,
  agentUsername: string,
): string {
  const { review, pull_request, repository } = payload;

  let prompt = `A reviewer has requested changes on a pull request you are working on.\n\n`;

  prompt += `## Repository\n${repository.full_name} (${repository.html_url})\n\n`;
  prompt += `## Pull Request #${pull_request.number}: ${pull_request.title}\n`;
  prompt += `URL: ${pull_request.html_url}\n`;
  prompt += `Branch: \`${pull_request.head.ref}\` → \`${pull_request.base.ref}\`\n`;
  prompt += `Head SHA: ${pull_request.head.sha}\n`;

  if (pull_request.body) {
    prompt += `\n### PR Description\n${pull_request.body}\n`;
  }

  prompt += `\n## Review by @${review.user.login}\n`;
  prompt += `State: ${review.state.toUpperCase()}\n`;
  prompt += `Submitted: ${review.submitted_at}\n`;

  if (review.body) {
    prompt += `\n### Review Summary\n${review.body}\n`;
  }

  prompt += `\n## Your Task\n`;
  prompt += `As @${agentUsername}, please:\n`;
  prompt += `1. Pull the latest changes for branch \`${pull_request.head.ref}\`.\n`;
  prompt += `2. Read the review feedback carefully and address ALL requested changes.\n`;
  prompt += `3. Also fetch and review any inline review comments on the PR using \`gh pr view ${pull_request.number} --repo ${repository.full_name} --comments\` and \`gh api repos/${repository.full_name}/pulls/${pull_request.number}/reviews\`.\n`;
  prompt += `4. Make the necessary code changes.\n`;
  prompt += `5. Commit with a descriptive message like "Address review feedback from @${review.user.login}".\n`;
  prompt += `6. Push the changes to \`${pull_request.head.ref}\`.\n`;
  prompt += `7. Reply with a summary of all changes made (this will be posted as a PR comment).\n`;

  return prompt;
}

export function formatPRReviewCommentAsPrompt(
  payload: PullRequestReviewCommentPayload,
  agentUsername: string,
): string {
  const { comment, pull_request, repository } = payload;

  let prompt = `You have been mentioned in a pull request inline review comment.\n\n`;

  prompt += `## Repository\n${repository.full_name} (${repository.html_url})\n\n`;
  prompt += `## Pull Request #${pull_request.number}: ${pull_request.title}\n`;
  prompt += `URL: ${pull_request.html_url}\n`;
  prompt += `Branch: \`${pull_request.head.ref}\` → \`${pull_request.base.ref}\`\n`;

  prompt += `\n## Inline Comment by @${comment.user.login}\n`;
  prompt += `File: \`${comment.path}\`\n`;
  if (comment.line != null) {
    prompt += `Line: ${comment.line}\n`;
  }

  if (comment.diff_hunk) {
    prompt += `\n### Diff Context\n\`\`\`diff\n${comment.diff_hunk}\n\`\`\`\n`;
  }

  prompt += `\n### Comment\n${comment.body}\n`;

  prompt += `\n## Your Task\n`;
  prompt += `As @${agentUsername}, please:\n`;
  prompt += `1. Pull the latest changes for branch \`${pull_request.head.ref}\`.\n`;
  prompt += `2. Locate the file \`${comment.path}\`${comment.line != null ? ` around line ${comment.line}` : ''}.\n`;
  prompt += `3. Address the comment — make the requested change or answer the question.\n`;
  prompt += `4. Commit and push to \`${pull_request.head.ref}\` if you made changes.\n`;
  prompt += `5. Reply with a summary of what you did (this will be posted as a reply to the review comment).\n`;

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

// ---------------------------------------------------------------------------
// GitHub comment posting
// ---------------------------------------------------------------------------

export interface PostCommentOptions {
  token: string;
  repoFullName: string;
  issueOrPrNumber: number;
  body: string;
}

export interface PostPRReviewCommentReplyOptions {
  token: string;
  repoFullName: string;
  prNumber: number;
  body: string;
}

/**
 * Post a comment on a GitHub issue or PR (issue comments endpoint covers both).
 */
export async function postGitHubComment(
  options: PostCommentOptions,
): Promise<{ id: number; html_url: string } | null> {
  const { token, repoFullName, issueOrPrNumber, body } = options;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/issues/${issueOrPrNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body }),
      },
    );

    if (!response.ok) {
      console.error(
        `Failed to post GitHub comment: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as { id: number; html_url: string };
    return data;
  } catch (error) {
    console.error('Error posting GitHub comment:', error);
    return null;
  }
}

/**
 * Post a review comment reply on a PR (via the pull request review comments endpoint).
 */
export async function postGitHubPRComment(
  options: PostPRReviewCommentReplyOptions,
): Promise<{ id: number; html_url: string } | null> {
  const { token, repoFullName, prNumber, body } = options;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body }),
      },
    );

    if (!response.ok) {
      console.error(
        `Failed to post GitHub PR comment: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as { id: number; html_url: string };
    return data;
  } catch (error) {
    console.error('Error posting GitHub PR comment:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '');
}
