/**
 * Polls GitHub for activity on the agent's own account — CI/review status on
 * its open PRs, and notifications (mentions, review requests, comments) — and
 * feeds each new finding into the engine via receiveMessage(), the same path
 * a person's chat message takes. Routing from there (which workstream, or a
 * new one) is the communicator's job; this module only detects and reports.
 */

export interface GithubWatchPrState {
  checksConclusion?: string;
  reviewDecision?: string;
  lastCommentId?: string;
}

export interface GithubWatchState {
  /** ISO timestamp; empty string means "not yet initialized". */
  notificationsSince: string;
  seenNotificationIds: string[];
  prs: Record<string, GithubWatchPrState>;
}

export function emptyGithubWatchState(): GithubWatchState {
  return { notificationsSince: '', seenNotificationIds: [], prs: {} };
}

const MAX_SEEN_NOTIFICATIONS = 200;

interface SearchPrItem {
  url: string;
  number: number;
  title: string;
  repository: { nameWithOwner: string } | string;
}

interface CheckRollupItem {
  conclusion?: string | null;
  state?: string | null;
}

interface PrComment {
  id: string;
  body?: string;
}

interface PrDetail {
  url: string;
  statusCheckRollup?: CheckRollupItem[] | null;
  reviewDecision?: string | null;
  comments?: PrComment[] | null;
}

interface GithubNotification {
  id: string;
  reason: string;
  updated_at: string;
  subject: { title: string; url: string; type: string };
  repository: { full_name: string };
}

export interface GithubWatchDeps {
  /** Runs `gh <args>` and returns its stdout. */
  runGh: (args: string) => Promise<string>;
  state: GithubWatchState;
  /** engine.receiveMessage — same path a real chat message takes. */
  receiveMessage: (content: string) => Promise<unknown>;
  log?: (message: string) => void;
}

function repoFullName(repository: SearchPrItem['repository']): string {
  return typeof repository === 'string' ? repository : repository.nameWithOwner;
}

function summarizeChecks(
  rollup: CheckRollupItem[] | null | undefined,
): string | undefined {
  if (!rollup || rollup.length === 0) return undefined;
  const statuses = rollup.map((c) => c.conclusion ?? c.state ?? null);
  if (
    statuses.some((s) => s === 'FAILURE' || s === 'ERROR' || s === 'TIMED_OUT')
  ) {
    return 'FAILURE';
  }
  if (
    statuses.some(
      (s) =>
        s === null || s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED',
    )
  ) {
    return 'PENDING';
  }
  return 'SUCCESS';
}

function prMessage(
  kind: 'ci-failed' | 'changes-requested' | 'new-comment',
  pr: { url: string; number: number; title: string; repo: string },
  detail?: string,
): string {
  const suffix = detail ? `: ${detail}` : '';
  switch (kind) {
    case 'ci-failed':
      return `[GitHub] CI failed on your PR #${pr.number} in ${pr.repo} ("${pr.title}")${suffix}. ${pr.url}`;
    case 'changes-requested':
      return `[GitHub] Changes requested on your PR #${pr.number} in ${pr.repo} ("${pr.title}")${suffix}. ${pr.url}`;
    case 'new-comment':
      return `[GitHub] New review comment on your PR #${pr.number} in ${pr.repo} ("${pr.title}")${suffix}. ${pr.url}`;
  }
}

function notificationMessage(n: GithubNotification): string {
  const repo = n.repository.full_name;
  const kind =
    n.subject.type === 'PullRequest' ? 'PR' : n.subject.type.toLowerCase();
  const url = n.subject.url.replace(
    'https://api.github.com/repos/',
    'https://github.com/',
  );
  return `[GitHub] You were mentioned in ${repo} ${kind} "${n.subject.title}" (reason: ${n.reason}). ${url} repoUrl: https://github.com/${repo}`;
}

async function checkOwnPrs(deps: GithubWatchDeps): Promise<void> {
  const { runGh, state, receiveMessage, log } = deps;

  let prs: SearchPrItem[];
  try {
    const raw = await runGh(
      'search prs --author=@me --state=open --json url,number,title,repository --limit 50',
    );
    prs = JSON.parse(raw) as SearchPrItem[];
  } catch (err) {
    log?.(`github-watch: failed to list own PRs: ${(err as Error).message}`);
    return;
  }

  for (const pr of prs) {
    const repo = repoFullName(pr.repository);
    let detail: PrDetail;
    try {
      const raw = await runGh(
        `pr view ${pr.number} --repo ${repo} --json url,statusCheckRollup,reviewDecision,comments`,
      );
      detail = JSON.parse(raw) as PrDetail;
    } catch (err) {
      log?.(
        `github-watch: failed to inspect PR ${repo}#${pr.number}: ${(err as Error).message}`,
      );
      continue;
    }

    const checksConclusion = summarizeChecks(detail.statusCheckRollup);
    const reviewDecision = detail.reviewDecision ?? undefined;
    const comments = detail.comments ?? [];
    const lastComment = comments[comments.length - 1];
    const info = { url: pr.url, number: pr.number, title: pr.title, repo };

    const prev = state.prs[pr.url];
    if (prev) {
      if (
        checksConclusion === 'FAILURE' &&
        prev.checksConclusion !== 'FAILURE'
      ) {
        await receiveMessage(prMessage('ci-failed', info));
      }
      if (
        reviewDecision === 'CHANGES_REQUESTED' &&
        prev.reviewDecision !== 'CHANGES_REQUESTED'
      ) {
        await receiveMessage(prMessage('changes-requested', info));
      }
      if (lastComment && lastComment.id !== prev.lastCommentId) {
        await receiveMessage(
          prMessage('new-comment', info, lastComment.body?.slice(0, 200)),
        );
      }
    }

    state.prs[pr.url] = {
      checksConclusion,
      reviewDecision,
      lastCommentId: lastComment?.id,
    };
  }

  const currentUrls = new Set(prs.map((pr) => pr.url));
  for (const url of Object.keys(state.prs)) {
    if (!currentUrls.has(url)) delete state.prs[url];
  }
}

async function checkNotifications(deps: GithubWatchDeps): Promise<void> {
  const { runGh, state, receiveMessage, log } = deps;

  if (!state.notificationsSince) {
    // First run: establish a baseline, don't replay history.
    state.notificationsSince = new Date().toISOString();
    return;
  }

  let notifications: GithubNotification[];
  try {
    const raw = await runGh(
      `api notifications -f since=${state.notificationsSince} -f participating=true --paginate`,
    );
    notifications = JSON.parse(raw) as GithubNotification[];
  } catch (err) {
    log?.(
      `github-watch: failed to list notifications: ${(err as Error).message}`,
    );
    return;
  }

  const seen = new Set(state.seenNotificationIds);
  let latest = state.notificationsSince;

  for (const n of notifications) {
    if (n.updated_at > latest) latest = n.updated_at;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    await receiveMessage(notificationMessage(n));
  }

  state.notificationsSince = latest;
  state.seenNotificationIds = [...seen].slice(-MAX_SEEN_NOTIFICATIONS);
}

/** Runs one poll cycle and returns the updated state for the caller to persist. */
export async function runGithubWatchCycle(
  deps: GithubWatchDeps,
): Promise<GithubWatchState> {
  const state: GithubWatchState = {
    notificationsSince: deps.state.notificationsSince,
    seenNotificationIds: [...deps.state.seenNotificationIds],
    prs: { ...deps.state.prs },
  };
  const scoped = { ...deps, state };

  await checkOwnPrs(scoped);
  await checkNotifications(scoped);

  return state;
}
