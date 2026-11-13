import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  PermissionOption,
  RequestPermissionRequest,
  ToolKind,
} from '@agentclientprotocol/sdk';
import { shellApprovalKey, type ToolPolicyFile } from '../tools/tool-policy.js';
import { decidePermission, type PermissionContext } from './acp-permissions.js';

const DEFAULT_OPTIONS: PermissionOption[] = [
  { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
  { optionId: 'a2', name: 'Always', kind: 'allow_always' },
  { optionId: 'r1', name: 'Reject', kind: 'reject_once' },
];

function req(
  kind: ToolKind,
  rawInput?: unknown,
  options: PermissionOption[] = DEFAULT_OPTIONS,
  locations?: string[],
  title?: string,
): RequestPermissionRequest {
  return {
    sessionId: 's1',
    options,
    toolCall: {
      toolCallId: 't1',
      kind,
      title,
      rawInput,
      locations: locations?.map((path) => ({ path })),
    },
  };
}

const emptyPolicy: ToolPolicyFile = { version: 1, rules: [] };
function ctx(over: Partial<PermissionContext> = {}): PermissionContext {
  return {
    role: 'worker',
    workspaceDir: '/ws',
    policy: emptyPolicy,
    cancelling: false,
    ...over,
  };
}
function selected(o: ReturnType<typeof decidePermission>): string | undefined {
  return o.response.outcome.outcome === 'selected'
    ? o.response.outcome.optionId
    : undefined;
}

describe('decidePermission', () => {
  it('non-dangerous execute is allowed once', () => {
    const o = decidePermission(req('execute', { command: 'ls -la' }), ctx());
    assert.equal(selected(o), 'a1');
    assert.equal(o.tool, 'run_shell');
    assert.equal(o.decision, 'allow');
  });

  it('dangerous execute without rule is rejected with proposedRule', () => {
    const o = decidePermission(
      req('execute', { command: 'rm -rf build' }),
      ctx(),
    );
    assert.equal(selected(o), 'r1');
    assert.equal(o.decision, 'deny');
    assert.equal(o.proposedRule?.pattern, shellApprovalKey('rm -rf build'));
  });

  it('dangerous execute with allow rule is allowed', () => {
    const key = shellApprovalKey('rm -rf build');
    const policy: ToolPolicyFile = {
      version: 1,
      rules: [
        {
          id: 'rule1',
          tool: 'run_shell',
          pattern: key,
          effect: 'allow',
          scope: 'agent',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const o = decidePermission(
      req('execute', { command: 'rm -rf build' }),
      ctx({ policy }),
    );
    assert.equal(selected(o), 'a1');
    assert.equal(o.ruleId, 'rule1');
  });

  it('explicit deny rule rejects without proposedRule', () => {
    const policy: ToolPolicyFile = {
      version: 1,
      rules: [
        {
          id: 'deny1',
          tool: 'run_shell',
          pattern: shellApprovalKey('rm -rf build'),
          effect: 'deny',
          scope: 'agent',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const o = decidePermission(
      req('execute', { command: 'rm -rf build' }),
      ctx({ policy }),
    );
    assert.equal(o.decision, 'deny');
    assert.equal(selected(o), 'r1');
    assert.equal(o.ruleId, 'deny1');
    assert.equal(o.proposedRule, undefined);
  });

  it('write kind with no locations is allowed for worker', () => {
    const o = decidePermission(req('edit', {}), ctx());
    assert.equal(o.decision, 'allow');
  });

  it('argv rawInput is joined', () => {
    const o = decidePermission(
      req('execute', { command: ['git', 'push', 'origin', 'x'] }),
      ctx(),
    );
    assert.equal(o.approvalKey, shellApprovalKey('git push origin x'));
  });

  it('missing command falls back to title', () => {
    const o = decidePermission(
      req('execute', undefined, undefined, undefined, 'rm -rf build'),
      ctx(),
    );
    assert.equal(o.approvalKey, shellApprovalKey('rm -rf build'));
    assert.equal(selected(o), 'r1');
  });

  it('POST fetch is gated, GET is not', () => {
    const post = decidePermission(
      req('fetch', { url: 'https://example.com/x', method: 'POST' }),
      ctx(),
    );
    assert.equal(post.tool, 'fetch_url');
    assert.equal(selected(post), 'r1');
    assert.ok(post.proposedRule);
    const get = decidePermission(
      req('fetch', { url: 'https://example.com/x' }),
      ctx(),
    );
    assert.equal(selected(get), 'a1');
  });

  it('reviewer edit is hard-denied', () => {
    const o = decidePermission(
      req('edit', {}, undefined, ['/ws/a.ts']),
      ctx({ role: 'reviewer' }),
    );
    assert.equal(selected(o), 'r1');
    assert.ok(o.reason);
    assert.equal(o.proposedRule, undefined);
  });

  it('edit outside workspace is hard-denied', () => {
    const o = decidePermission(
      req('edit', {}, undefined, ['../../etc/passwd']),
      ctx(),
    );
    assert.equal(o.decision, 'deny');
    assert.ok(o.reason);
    assert.equal(o.proposedRule, undefined);
  });

  it('edit inside workspace is allowed', () => {
    const o = decidePermission(
      req('edit', {}, undefined, ['/ws/src/a.ts']),
      ctx(),
    );
    assert.equal(selected(o), 'a1');
    assert.equal(o.tool, 'write_file');
  });

  it('git stash execute is hard-denied for worker', () => {
    const o = decidePermission(req('execute', { command: 'git stash' }), ctx());
    assert.equal(o.decision, 'deny');
    assert.ok(o.reason);
    assert.equal(o.proposedRule, undefined);
  });

  it('reviewer shell write is hard-denied; worker same command is allowed', () => {
    const cmd = { command: 'sed -i s/a/b/ f.txt' };
    const reviewer = decidePermission(
      req('execute', cmd),
      ctx({ role: 'reviewer' }),
    );
    assert.equal(selected(reviewer), 'r1');
    assert.equal(reviewer.decision, 'deny');
    assert.equal(reviewer.tool, 'run_shell');
    assert.match(reviewer.reason ?? '', /reviewer is read-only/);
    assert.equal(reviewer.proposedRule, undefined);

    const worker = decidePermission(req('execute', cmd), ctx());
    assert.equal(selected(worker), 'a1');
    assert.equal(worker.decision, 'allow');
  });

  it('read/search/think are allowed', () => {
    for (const k of ['read', 'search', 'think'] as const) {
      const o = decidePermission(req(k), ctx());
      assert.equal(selected(o), 'a1');
      assert.equal(o.tool, `acp:${k}`);
    }
  });

  it('only allow_always offered → denied, never selected', () => {
    const o = decidePermission(
      req('read', undefined, [
        { optionId: 'a2', name: 'Always', kind: 'allow_always' },
        { optionId: 'r1', name: 'Reject', kind: 'reject_once' },
      ]),
      ctx(),
    );
    assert.equal(selected(o), 'r1');
    assert.equal(o.decision, 'deny');
    assert.equal(o.reason, 'no allow_once option');
  });

  it('deny with no reject_once → cancelled outcome', () => {
    const o = decidePermission(
      req('execute', { command: 'rm -rf build' }, [
        { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
      ]),
      ctx(),
    );
    assert.deepEqual(o.response, { outcome: { outcome: 'cancelled' } });
  });

  it('cancelling → cancelled outcome even for read', () => {
    const o = decidePermission(req('read'), ctx({ cancelling: true }));
    assert.deepEqual(o.response, { outcome: { outcome: 'cancelled' } });
    assert.equal(o.decision, 'deny');
  });
});
