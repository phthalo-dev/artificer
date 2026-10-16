import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRepos, matchRepo, repoUrlKey } from './repos.js';

test('https and git@ URLs of the same repo share a key', () => {
  const https = repoUrlKey('https://github.com/Org/Repo.git');
  const ssh = repoUrlKey('git@github.com:org/repo.git');
  const slash = repoUrlKey('ssh://git@github.com/org/repo/');
  assert.equal(https, 'github.com/org/repo');
  assert.equal(ssh, https);
  assert.equal(slash, https);
});

test('loadRepos rejects a missing field and a duplicate key', () => {
  const missing = loadRepos([{ id: 'app', url: 'https://github.com/a/b' }]);
  assert.equal(missing.ok, false);
  const dup = loadRepos([
    { id: 'app', url: 'https://github.com/a/b.git', baseBranch: 'main' },
    { id: 'app2', url: 'git@github.com:a/b.git', baseBranch: 'main' },
  ]);
  assert.equal(dup.ok, false);
});

test('matchRepo finds the listed repo', () => {
  const loaded = loadRepos([
    { id: 'app', url: 'https://github.com/a/b.git', baseBranch: 'main' },
  ]);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(matchRepo(loaded.repos, 'git@github.com:a/b.git')?.id, 'app');
  assert.equal(matchRepo(loaded.repos, 'https://github.com/other/x'), undefined);
});
