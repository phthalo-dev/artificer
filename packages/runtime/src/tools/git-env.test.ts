import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { buildGitEnv } from './git-env.js';

describe('buildGitEnv', () => {
  it('sets GIT_CEILING_DIRECTORIES when workspaceDir is provided', () => {
    const env = buildGitEnv(
      { token: 'ghp_test' },
      {},
      '/home/user/my-agent/.artificer/workspace/ws_abc123',
    );

    assert.equal(
      env.GIT_CEILING_DIRECTORIES,
      '/home/user/my-agent/.artificer/workspace',
    );
  });

  it('does not set GIT_CEILING_DIRECTORIES without workspaceDir', () => {
    const env = buildGitEnv({ token: 'ghp_test' }, {});
    assert.equal(env.GIT_CEILING_DIRECTORIES, undefined);
  });

  it('preserves existing env vars', () => {
    const env = buildGitEnv(
      { token: 'ghp_test' },
      { HOME: '/home/user', EXISTING: 'value' },
      '/workspace/ws_1',
    );

    assert.equal(env.HOME, '/home/user');
    assert.equal(env.EXISTING, 'value');
    assert.equal(env.GH_TOKEN, 'ghp_test');
  });

  it('sets GIT_CEILING_DIRECTORIES even without github config', () => {
    const env = buildGitEnv(
      undefined,
      { HOME: '/home/user' },
      '/home/user/agent/.artificer/workspace/ws_1',
    );

    assert.equal(
      env.GIT_CEILING_DIRECTORIES,
      '/home/user/agent/.artificer/workspace',
    );
    assert.equal(env.HOME, '/home/user');
  });

  it('returns base env unchanged when no github and no workspaceDir', () => {
    const base = { HOME: '/home/user' };
    const env = buildGitEnv(undefined, base);
    assert.equal(env, base);
  });
});
