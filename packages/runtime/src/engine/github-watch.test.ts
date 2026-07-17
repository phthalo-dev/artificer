import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyGithubWatchState,
  runGithubWatchCycle,
  type GithubWatchState,
} from './github-watch.js';

const SEARCH_PRS_PREFIX = 'search prs --author=@me';
const PR_VIEW_PREFIX = 'pr view 123';
const NOTIFICATIONS_PREFIX = 'api notifications';

const OPEN_PR = {
  url: 'https://github.com/acme/widgets/pull/123',
  number: 123,
  title: 'Fix foo',
  repository: { nameWithOwner: 'acme/widgets' },
};

function stubRunGh(responses: Record<string, string>) {
  const calls: string[] = [];
  const runGh = async (args: string) => {
    calls.push(args);
    for (const [prefix, response] of Object.entries(responses)) {
      if (args.startsWith(prefix)) return response;
    }
    throw new Error(`unexpected gh command: ${args}`);
  };
  return { runGh, calls };
}

function withMessages() {
  const messages: string[] = [];
  const receiveMessage = async (content: string) => {
    messages.push(content);
  };
  return { receiveMessage, messages };
}

test('first sighting of a PR records a baseline and sends no message', async () => {
  const { runGh } = stubRunGh({
    [SEARCH_PRS_PREFIX]: JSON.stringify([OPEN_PR]),
    [PR_VIEW_PREFIX]: JSON.stringify({
      url: OPEN_PR.url,
      statusCheckRollup: [{ conclusion: 'SUCCESS' }],
      reviewDecision: null,
      comments: [],
    }),
    [NOTIFICATIONS_PREFIX]: JSON.stringify([]),
  });
  const { receiveMessage, messages } = withMessages();

  const state = await runGithubWatchCycle({
    runGh,
    state: emptyGithubWatchState(),
    receiveMessage,
  });

  assert.equal(messages.length, 0);
  assert.deepEqual(state.prs[OPEN_PR.url], {
    checksConclusion: 'SUCCESS',
    reviewDecision: undefined,
    lastCommentId: undefined,
  });
});

test('a CI conclusion change from the stored state sends one CI-failed message', async () => {
  const { runGh } = stubRunGh({
    [SEARCH_PRS_PREFIX]: JSON.stringify([OPEN_PR]),
    [PR_VIEW_PREFIX]: JSON.stringify({
      url: OPEN_PR.url,
      statusCheckRollup: [{ conclusion: 'FAILURE' }],
      reviewDecision: null,
      comments: [],
    }),
    [NOTIFICATIONS_PREFIX]: JSON.stringify([]),
  });
  const { receiveMessage, messages } = withMessages();

  const initialState: GithubWatchState = {
    notificationsSince: '2024-01-01T00:00:00.000Z',
    seenNotificationIds: [],
    prs: {
      [OPEN_PR.url]: {
        checksConclusion: 'SUCCESS',
        reviewDecision: undefined,
        lastCommentId: undefined,
      },
    },
  };

  await runGithubWatchCycle({ runGh, state: initialState, receiveMessage });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /\[GitHub\] CI failed/);
  assert.match(messages[0], /#123 in acme\/widgets/);
  assert.match(messages[0], /https:\/\/github\.com\/acme\/widgets\/pull\/123/);
});

test('a new notification sends one mention message and is recorded as seen', async () => {
  const notification = {
    id: 'notif1',
    reason: 'mention',
    updated_at: '2024-01-02T00:00:00.000Z',
    subject: {
      title: 'App crashes on startup',
      url: 'https://api.github.com/repos/acme/widgets/issues/45',
      type: 'Issue',
    },
    repository: { full_name: 'acme/widgets' },
  };
  const { runGh } = stubRunGh({
    [SEARCH_PRS_PREFIX]: JSON.stringify([]),
    [NOTIFICATIONS_PREFIX]: JSON.stringify([notification]),
  });
  const { receiveMessage, messages } = withMessages();

  const initialState: GithubWatchState = {
    notificationsSince: '2024-01-01T00:00:00.000Z',
    seenNotificationIds: [],
    prs: {},
  };

  const state = await runGithubWatchCycle({
    runGh,
    state: initialState,
    receiveMessage,
  });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /\[GitHub\] You were mentioned/);
  assert.match(messages[0], /acme\/widgets/);
  assert.match(messages[0], /https:\/\/github\.com\/acme\/widgets\/issues\/45/);
  assert.deepEqual(state.seenNotificationIds, ['notif1']);
});

test('a previously-seen notification is not re-sent', async () => {
  const notification = {
    id: 'notif1',
    reason: 'mention',
    updated_at: '2024-01-02T00:00:00.000Z',
    subject: {
      title: 'App crashes on startup',
      url: 'https://api.github.com/repos/acme/widgets/issues/45',
      type: 'Issue',
    },
    repository: { full_name: 'acme/widgets' },
  };
  const { runGh } = stubRunGh({
    [SEARCH_PRS_PREFIX]: JSON.stringify([]),
    [NOTIFICATIONS_PREFIX]: JSON.stringify([notification]),
  });
  const { receiveMessage, messages } = withMessages();

  const initialState: GithubWatchState = {
    notificationsSince: '2024-01-01T00:00:00.000Z',
    seenNotificationIds: ['notif1'],
    prs: {},
  };

  await runGithubWatchCycle({ runGh, state: initialState, receiveMessage });

  assert.equal(messages.length, 0);
});

test('the first cycle ever establishes a notification baseline without replaying history', async () => {
  const { runGh, calls } = stubRunGh({
    [SEARCH_PRS_PREFIX]: JSON.stringify([]),
  });
  const { receiveMessage, messages } = withMessages();

  const state = await runGithubWatchCycle({
    runGh,
    state: emptyGithubWatchState(),
    receiveMessage,
  });

  assert.equal(messages.length, 0);
  assert.notEqual(state.notificationsSince, '');
  assert.ok(
    !calls.some((c) => c.startsWith(NOTIFICATIONS_PREFIX)),
    'should not call gh api notifications on the very first cycle',
  );
});
