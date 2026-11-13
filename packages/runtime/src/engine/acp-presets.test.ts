import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAcpLaunch } from './acp-presets.js';

const ASK = {
  bash: 'ask',
  edit: 'ask',
  webfetch: 'ask',
  external_directory: 'ask',
};

test('opencode preset resolves launch', () => {
  const l = resolveAcpLaunch({ type: 'acp', agent: 'opencode' });
  assert.equal(l.name, 'acp:opencode');
  assert.equal(l.command, 'opencode');
  assert.deepEqual(l.args, ['acp']);
  assert.equal(l.resumes, true);
  assert.equal(l.permissionEnforcement, 'acp-requests');
  assert.deepEqual(JSON.parse(l.env.OPENCODE_CONFIG_CONTENT!), {
    permission: ASK,
  });
});

test('user permission is overridden', () => {
  const l = resolveAcpLaunch({
    type: 'acp',
    agent: 'opencode',
    env: {
      OPENCODE_CONFIG_CONTENT: '{"permission":{"bash":"allow"},"model":"x"}',
      FOO: 'bar',
    },
  });
  assert.deepEqual(JSON.parse(l.env.OPENCODE_CONFIG_CONTENT!), {
    permission: ASK,
    model: 'x',
  });
  assert.equal(l.env.FOO, 'bar');
});

test('invalid user OPENCODE_CONFIG_CONTENT throws', () => {
  assert.throws(
    () =>
      resolveAcpLaunch({
        type: 'acp',
        agent: 'opencode',
        env: { OPENCODE_CONFIG_CONTENT: '{nope' },
      }),
    /acp:opencode: OPENCODE_CONFIG_CONTENT is not valid JSON/,
  );
});

test('custom command resolves as before', () => {
  const l = resolveAcpLaunch({
    type: 'acp',
    command: '/usr/bin/gemini',
    args: ['--acp'],
  });
  assert.equal(l.name, 'acp:gemini');
  assert.equal(l.permissionEnforcement, 'none');
  assert.equal(l.resumes, false);
  assert.deepEqual(l.env, {});
});

test('config.resumes overrides preset', () => {
  assert.equal(
    resolveAcpLaunch({ type: 'acp', agent: 'opencode', resumes: false })
      .resumes,
    false,
  );
});

test('agent and command together throws; neither throws', () => {
  assert.throws(() =>
    resolveAcpLaunch({
      type: 'acp',
      agent: 'opencode',
      command: 'x',
      args: [],
    }),
  );
  assert.throws(() => resolveAcpLaunch({ type: 'acp' }));
});
