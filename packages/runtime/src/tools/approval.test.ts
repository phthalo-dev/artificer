import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RuntimeEvent, ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { decideApproval, enforceApproval } from './approval.js';
import { createFetchTools } from './fetch.js';
import { createShellTool } from './shell.js';
import type { PolicyRule, ToolPolicyFile } from './tool-policy.js';

const EMPTY_POLICY: ToolPolicyFile = { version: 1, rules: [] };

function gatedTool(
  overrides: Partial<ToolDef> & Pick<ToolDef, 'handler'> = {
    handler: async () => 'ran',
  },
): ToolDef {
  return {
    name: 'gated',
    description: 'needs approval',
    inputSchema: { type: 'object', properties: {} },
    needsApproval: true,
    ...overrides,
  };
}

function rule(
  effect: PolicyRule['effect'],
  tool = 'gated',
  pattern = '*',
): PolicyRule {
  return {
    id: `${effect}-1`,
    tool,
    pattern,
    effect,
    scope: 'agent',
    createdAt: '2026-08-25T00:00:00.000Z',
  };
}

function parseDenied(result: string) {
  return JSON.parse(result) as {
    ok: false;
    kind: 'approval_required' | 'approval_denied';
    tool: string;
    approvalKey: string;
    message: string;
    proposedRule: {
      tool: string;
      pattern: string;
      effect: 'allow' | 'deny';
      scope: 'agent';
    };
  };
}

test('needsApproval true with empty policy returns approval_required and emits once', () => {
  const events: RuntimeEvent[] = [];
  const decision = enforceApproval({
    tool: gatedTool(),
    input: {},
    policy: EMPTY_POLICY,
    emit: (event) => events.push(event),
    runId: 'run_1',
    workstreamId: 'ws_1',
  });

  assert.equal(decision.allow, false);
  const payload = parseDenied(decision.result);
  assert.equal(payload.ok, false);
  assert.equal(payload.kind, 'approval_required');
  assert.equal(payload.tool, 'gated');
  assert.equal(payload.approvalKey, '*');
  assert.equal(payload.proposedRule.effect, 'allow');
  assert.equal(payload.proposedRule.scope, 'agent');
  assert.equal(payload.proposedRule.pattern, '*');
  assert.equal(payload.proposedRule.tool, 'gated');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'approval');
  if (events[0]?.kind === 'approval') {
    assert.equal(events[0].data.tool, 'gated');
    assert.equal(events[0].data.approvalKey, '*');
    assert.equal(events[0].data.runId, 'run_1');
    assert.equal(events[0].data.workstreamId, 'ws_1');
    assert.deepEqual(events[0].data.proposedRule, payload.proposedRule);
  }
});

test('matching allow rule permits the call', () => {
  const events: RuntimeEvent[] = [];
  const decision = enforceApproval({
    tool: gatedTool(),
    input: {},
    policy: { version: 1, rules: [rule('allow')] },
    emit: (event) => events.push(event),
  });

  assert.deepEqual(decision, { allow: true });
  assert.equal(events.length, 0);
});

test('matching deny rule returns approval_denied without emitting', () => {
  const events: RuntimeEvent[] = [];
  const decision = enforceApproval({
    tool: gatedTool(),
    input: {},
    policy: { version: 1, rules: [rule('deny')] },
    emit: (event) => events.push(event),
  });

  assert.equal(decision.allow, false);
  const payload = parseDenied(decision.result);
  assert.equal(payload.kind, 'approval_denied');
  assert.equal(payload.tool, 'gated');
  assert.equal(events.length, 0);
});

test('needsApproval false or absent does not consult policy', () => {
  const denied = {
    version: 1,
    rules: [rule('deny', 'open')],
  } as ToolPolicyFile;
  const events: RuntimeEvent[] = [];

  const absent = enforceApproval({
    tool: gatedTool({ needsApproval: undefined, name: 'open' }),
    input: {},
    policy: denied,
    emit: (event) => events.push(event),
  });
  const off = enforceApproval({
    tool: gatedTool({
      needsApproval: false,
      name: 'open',
    }),
    input: {},
    policy: denied,
    emit: (event) => events.push(event),
  });
  const fnFalse = enforceApproval({
    tool: gatedTool({
      name: 'open',
      needsApproval: () => false,
    }),
    input: {},
    policy: denied,
    emit: (event) => events.push(event),
  });

  assert.deepEqual(absent, { allow: true });
  assert.deepEqual(off, { allow: true });
  assert.deepEqual(fnFalse, { allow: true });
  assert.equal(events.length, 0);
});

test('needsApproval function true is gated', () => {
  const decision = enforceApproval({
    tool: gatedTool({
      needsApproval: (input) => input.force === true,
    }),
    input: { force: true },
    policy: EMPTY_POLICY,
  });

  assert.equal(decision.allow, false);
  assert.equal(parseDenied(decision.result).kind, 'approval_required');
});

test('run_shell approval key retains rm flags and the target path', () => {
  const decision = enforceApproval({
    tool: gatedTool({ name: 'run_shell' }),
    input: { command: 'rm -rf /tmp/build' },
    policy: EMPTY_POLICY,
  });

  assert.equal(decision.allow, false);
  const payload = parseDenied(decision.result);
  assert.equal(payload.approvalKey, 'rm -rf /tmp/build');
  assert.equal(payload.proposedRule.pattern, 'rm -rf /tmp/build');
  assert.notEqual(payload.proposedRule.pattern, 'rm -rf');
});

test('enforceApproval returns structured JSON for invalid fetch URLs', () => {
  const decision = enforceApproval({
    tool: gatedTool({ name: 'fetch' }),
    input: { method: 'POST', url: '' },
    policy: EMPTY_POLICY,
  });

  assert.equal(decision.allow, false);
  const payload = parseDenied(decision.result);
  assert.equal(payload.kind, 'approval_required');
  assert.equal(payload.approvalKey, 'POST <invalid-url>');
  assert.equal(payload.proposedRule.pattern, 'POST <invalid-url>');
});

test('fetch and fetch_url approval keys use method and url', () => {
  for (const name of ['fetch', 'fetch_url'] as const) {
    const decision = enforceApproval({
      tool: gatedTool({ name }),
      input: { method: 'post', url: 'https://example.com/api?x=1' },
      policy: EMPTY_POLICY,
    });
    assert.equal(decision.allow, false);
    assert.equal(
      parseDenied(decision.result).approvalKey,
      'POST https://example.com/api',
    );
  }
});

test('run_shell needsApproval follows isDangerousShellCommand', () => {
  const [tool] = createShellTool({
    engine: { config: {} },
    run: { role: 'worker' },
    workspaceDir: '/tmp',
  } as ToolContext);
  const needsApproval = tool.needsApproval;
  assert.equal(typeof needsApproval, 'function');
  if (typeof needsApproval !== 'function') return;
  assert.equal(needsApproval({ command: 'rm -rf /' }), true);
  assert.equal(needsApproval({ command: 'git status' }), false);
  assert.equal(needsApproval({ command: 'git checkout abc123' }), false);
});

test('fetch_url needsApproval gates non-GET only', () => {
  const [tool] = createFetchTools({} as ToolContext);
  const needsApproval = tool.needsApproval;
  assert.equal(typeof needsApproval, 'function');
  if (typeof needsApproval !== 'function') return;
  assert.equal(needsApproval({ url: 'https://example.com' }), false);
  assert.equal(
    needsApproval({ method: 'GET', url: 'https://example.com' }),
    false,
  );
  assert.equal(
    needsApproval({ method: 'POST', url: 'https://example.com' }),
    true,
  );
});

test('decideApproval allows on matching allow rule', () => {
  const r = { ...rule('allow', 'gated', 'ls'), id: 'r1' };
  const d = decideApproval({
    tool: 'gated',
    approvalKey: 'ls',
    policy: { version: 1, rules: [r] },
  });
  assert.equal(d.allow, true);
  assert.equal(d.allow && d.rule?.id, r.id);
});

test('decideApproval denies on matching deny rule', () => {
  const d = decideApproval({
    tool: 'gated',
    approvalKey: 'ls',
    policy: { version: 1, rules: [rule('deny', 'gated', 'ls')] },
  });
  assert.equal(d.allow, false);
  assert.equal(!d.allow && d.kind, 'approval_denied');
});

test('decideApproval requires approval with no match', () => {
  const d = decideApproval({
    tool: 'gated',
    approvalKey: 'ls',
    policy: EMPTY_POLICY,
  });
  assert.equal(d.allow, false);
  assert.equal(!d.allow && d.kind, 'approval_required');
  assert.equal(!d.allow && d.proposedRule.pattern, 'ls');
});
