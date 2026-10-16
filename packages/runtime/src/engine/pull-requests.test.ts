import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from '../storage/store.js';
import { capturePullRequests, pullRequestMentions } from './pull-requests.js';
import { WorkstreamArtifactService } from './workstream-artifacts.js';

async function artifactFixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-prs-'));
  const store = new Store(dataDir);
  await store.init();
  const service = new WorkstreamArtifactService(store, async () => {});
  const workstream = await store.createWorkstream({
    title: 'Pull request test',
    goal: 'Capture pull request artifacts',
  });
  return { service, store, wsId: workstream.id };
}

test('the same pull request URL publishes one artifact', async () => {
  const text = 'Opened https://github.com/Org/Repo/pull/12 today';
  const mentions = pullRequestMentions(text);
  assert.deepEqual(mentions, [
    {
      url: 'https://github.com/Org/Repo/pull/12',
      owner: 'Org',
      repo: 'Repo',
      number: 12,
      key: 'pr-org-repo-12',
    },
  ]);
});

test('capture publishes a pull request once and skips an existing key', async () => {
  const { service, wsId } = await artifactFixture();
  const text = 'Opened https://github.com/Org/Repo/pull/12 today';
  let calls = 0;
  const gh = async () => {
    calls += 1;
    if (calls > 1) throw new Error('gh should not be called twice');
    return { title: 'Fix login' };
  };

  await capturePullRequests({ artifacts: service, gh }, wsId, text);
  await capturePullRequests({ artifacts: service, gh }, wsId, text);

  const artifacts = await service.list(wsId);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].currentVersion, 'v1');
  assert.equal(calls, 1);
  const content = await service.readVersionContent(
    wsId,
    artifacts[0].key,
    'v1',
  );
  assert.equal(
    content.content.toString('utf8'),
    '# Fix login\n\nhttps://github.com/Org/Repo/pull/12\n',
  );
});
