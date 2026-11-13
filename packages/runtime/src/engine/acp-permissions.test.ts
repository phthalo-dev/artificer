import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type {
  PermissionOption,
  RequestPermissionRequest,
  ToolKind,
} from '@agentclientprotocol/sdk';
import { shellApprovalKey, type ToolPolicyFile } from '../tools/tool-policy.js';
import {
  decidePermission,
  fillPermissionRequest,
  type PermissionContext,
} from './acp-permissions.js';

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '__fixtures__',
      'codex-acp-2.6.0-recorded.json',
    ),
    'utf-8',
  ),
);

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

  it('detail-free execute is denied', () => {
    const o = decidePermission(
      {
        sessionId: 's1',
        options: DEFAULT_OPTIONS,
        toolCall: { toolCallId: 'x', kind: 'execute', status: 'pending' },
      },
      ctx(),
    );
    assert.equal(o.decision, 'deny');
    assert.equal(o.reason, 'no command to evaluate');
    assert.equal(selected(o), 'r1');
  });
});

describe('fillPermissionRequest', () => {
  it('copies tracked fields only when missing', () => {
    const base = req('execute', undefined, DEFAULT_OPTIONS, undefined, 'a');
    const titled = fillPermissionRequest(base, { title: 'b' });
    assert.equal(titled.toolCall.title, 'a');

    const filled = fillPermissionRequest(base, {
      rawInput: { command: 'ls' },
    });
    assert.deepEqual(filled.toolCall.rawInput, { command: 'ls' });

    const withNullLocations: RequestPermissionRequest = {
      ...base,
      toolCall: { ...base.toolCall, locations: null },
    };
    const located = fillPermissionRequest(withNullLocations, {
      locations: [{ path: 'a.txt' }],
    });
    assert.deepEqual(located.toolCall.locations, [{ path: 'a.txt' }]);
  });

  it('keeps the request when nothing is tracked and passes _meta through', () => {
    const r: RequestPermissionRequest = {
      ...req('execute', { command: 'ls' }),
      _meta: { is_mcp_tool_approval: true },
    };
    const out = fillPermissionRequest(r, undefined);
    assert.deepEqual(out, r);
  });
});

describe('MCP approvals', () => {
  const mcpRequest = (rawInput?: unknown): RequestPermissionRequest => {
    const tracked = fixture.mcpToolCallUpdate.update;
    return fillPermissionRequest(
      fixture.mcpPermissionRequest as RequestPermissionRequest,
      {
        title: tracked.title,
        kind: tracked.kind as ToolKind,
        rawInput: rawInput ?? tracked.rawInput,
      },
    );
  };
  const optionOf = (o: ReturnType<typeof decidePermission>) => selected(o);

  it('artificer-status MCP approval is allowed', () => {
    const o = decidePermission(mcpRequest(), ctx());
    assert.equal(o.decision, 'allow');
    assert.equal(o.tool, 'mcp:artificer-status.report_status');
    assert.equal(optionOf(o), 'allow_once');
  });

  it('foreign MCP approval is policy-gated', () => {
    const foreign = mcpRequest({
      server: 'evil',
      tool: 'exfil',
      arguments: {},
    });
    const denied = decidePermission(foreign, ctx());
    assert.equal(denied.decision, 'deny');
    assert.equal(optionOf(denied), 'cancel');
    assert.equal(denied.proposedRule?.tool, 'mcp:evil.exfil');
    assert.equal(denied.proposedRule?.pattern, 'evil.exfil');

    const policy: ToolPolicyFile = {
      version: 1,
      rules: [
        {
          id: 'mcp1',
          tool: 'mcp:evil.exfil',
          pattern: 'evil.exfil',
          effect: 'allow',
          scope: 'agent',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const allowed = decidePermission(foreign, ctx({ policy }));
    assert.equal(allowed.decision, 'allow');
    assert.equal(allowed.ruleId, 'mcp1');
    assert.equal(optionOf(allowed), 'allow_once');
  });

  it('meta flag alone marks MCP approval', () => {
    const o = decidePermission(
      fixture.mcpPermissionRequest as RequestPermissionRequest,
      ctx(),
    );
    assert.equal(o.decision, 'deny');
    assert.equal(o.reason, 'unknown MCP server');
    assert.equal(optionOf(o), 'cancel');
  });

  it('server/tool rawInput without meta flag is an MCP approval', () => {
    const o = decidePermission(
      req('execute', { server: 'evil', tool: 'exfil' }),
      ctx(),
    );
    assert.equal(o.tool, 'mcp:evil.exfil');
    assert.equal(o.decision, 'deny');
  });
});
