import assert from 'node:assert/strict';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
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

test('opencode preset disables project config', () => {
  const l = resolveAcpLaunch({ type: 'acp', agent: 'opencode' });
  assert.equal(l.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
});

test('user env cannot re-enable project config', () => {
  const l = resolveAcpLaunch({
    type: 'acp',
    agent: 'opencode',
    env: { OPENCODE_DISABLE_PROJECT_CONFIG: '0' },
  });
  assert.equal(l.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
});

test('preset args cannot be overridden', () => {
  assert.throws(
    () => resolveAcpLaunch({ type: 'acp', agent: 'opencode', args: [] }),
    /acp:opencode: args cannot be overridden for a preset/,
  );
});

test('custom command named like a preset is marked custom', () => {
  const l = resolveAcpLaunch({
    type: 'acp',
    command: '/usr/bin/opencode',
    args: ['acp'],
  });
  assert.equal(l.name, 'acp:custom:opencode');
  assert.equal(l.permissionEnforcement, 'none');
  assert.equal(
    resolveAcpLaunch({ type: 'acp', command: '/x/gemini', args: [] }).name,
    'acp:gemini',
  );
});

function withoutCodexKeys(t: TestContext): void {
  const saved = {
    CODEX_API_KEY: process.env.CODEX_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  delete process.env.CODEX_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('codex preset resolves launch', (t) => {
  withoutCodexKeys(t);
  const l = resolveAcpLaunch(
    { type: 'acp', agent: 'codex', env: { CODEX_API_KEY: 'test' } },
    { stateDir: '/state/acp' },
  );
  assert.equal(l.name, 'acp:codex');
  assert.equal(l.command, 'npx');
  assert.deepEqual(l.args, ['-y', '@agentclientprotocol/codex-acp@2.6.0']);
  assert.equal(l.resumes, true);
  assert.equal(l.permissionEnforcement, 'acp-requests');
  assert.equal(l.env.NO_BROWSER, '1');
  assert.equal(l.env.INITIAL_AGENT_MODE, 'read-only');
  assert.equal(l.env.DEFAULT_AUTH_REQUEST, '{"methodId":"api-key"}');
  assert.equal(l.env.CODEX_HOME, path.join('/state/acp', 'codex-home'));
});

test('codex forced env wins', (t) => {
  withoutCodexKeys(t);
  const l = resolveAcpLaunch(
    {
      type: 'acp',
      agent: 'codex',
      env: {
        CODEX_API_KEY: 'k',
        INITIAL_AGENT_MODE: 'agent-full-access',
        CODEX_HOME: '/tmp/x',
        NO_BROWSER: '0',
        DEFAULT_AUTH_REQUEST: '{}',
      },
    },
    { stateDir: '/state/acp' },
  );
  assert.equal(l.env.NO_BROWSER, '1');
  assert.equal(l.env.INITIAL_AGENT_MODE, 'read-only');
  assert.equal(l.env.DEFAULT_AUTH_REQUEST, '{"methodId":"api-key"}');
  assert.equal(l.env.CODEX_HOME, '/state/acp/codex-home');
});

test('codex without api key throws', (t) => {
  withoutCodexKeys(t);
  assert.throws(
    () => resolveAcpLaunch({ type: 'acp', agent: 'codex', env: {} }),
    {
      message:
        'acp:codex: set CODEX_API_KEY or OPENAI_API_KEY (Codex runs with API-key auth only)',
    },
  );
  assert.throws(
    () =>
      resolveAcpLaunch({
        type: 'acp',
        agent: 'codex',
        env: { CODEX_API_KEY: '' },
      }),
    /set CODEX_API_KEY or OPENAI_API_KEY/,
  );
});

test('OPENAI_API_KEY alone is accepted, from config or process env', (t) => {
  withoutCodexKeys(t);
  const a = resolveAcpLaunch({
    type: 'acp',
    agent: 'codex',
    env: { OPENAI_API_KEY: 'k' },
  });
  assert.equal(a.name, 'acp:codex');
  process.env.OPENAI_API_KEY = 'k';
  assert.equal(
    resolveAcpLaunch({ type: 'acp', agent: 'codex' }).name,
    'acp:codex',
  );
});

test('codex preset rejects args and custom codex command is namespaced', (t) => {
  withoutCodexKeys(t);
  assert.throws(
    () =>
      resolveAcpLaunch({
        type: 'acp',
        agent: 'codex',
        args: ['x'],
        env: { CODEX_API_KEY: 'k' },
      }),
    /args cannot be overridden/,
  );
  assert.equal(
    resolveAcpLaunch({ type: 'acp', command: '/bin/codex', args: [] }).name,
    'acp:custom:codex',
  );
});

test('codex key check trims and blank user keys do not shadow the process key', (t) => {
  withoutCodexKeys(t);
  assert.throws(
    () =>
      resolveAcpLaunch({
        type: 'acp',
        agent: 'codex',
        env: { CODEX_API_KEY: '   ', OPENAI_API_KEY: '\t' },
      }),
    /set CODEX_API_KEY or OPENAI_API_KEY/,
  );
  process.env.CODEX_API_KEY = '  ';
  assert.throws(
    () => resolveAcpLaunch({ type: 'acp', agent: 'codex' }),
    /set CODEX_API_KEY or OPENAI_API_KEY/,
  );
  process.env.CODEX_API_KEY = 'process-key';
  const l = resolveAcpLaunch({
    type: 'acp',
    agent: 'codex',
    env: { CODEX_API_KEY: '', OPENAI_API_KEY: ' ' },
  });
  // Dropped, so the spawn env ({...process.env, ...launch.env}) keeps the
  // process key.
  assert.ok(!('CODEX_API_KEY' in l.env));
  assert.ok(!('OPENAI_API_KEY' in l.env));
  assert.equal({ ...process.env, ...l.env }.CODEX_API_KEY, 'process-key');
});

test('codex preset pins npm config after the user env', (t) => {
  withoutCodexKeys(t);
  const l = resolveAcpLaunch(
    {
      type: 'acp',
      agent: 'codex',
      env: {
        CODEX_API_KEY: 'k',
        npm_config_registry: 'https://evil.test/',
        NPM_CONFIG_REGISTRY: 'https://evil.test/',
        npm_config_userconfig: '/tmp/evil-npmrc',
      },
    },
    { stateDir: '/state/acp' },
  );
  assert.equal(l.env.npm_config_registry, 'https://registry.npmjs.org/');
  assert.equal(l.env.npm_config_userconfig, '/state/acp/npmrc');
  assert.ok(!('NPM_CONFIG_REGISTRY' in l.env));
});
