import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

  it('write kind with no locations is denied for worker', () => {
    for (const kind of ['edit', 'delete', 'move'] as const) {
      const o = decidePermission(req(kind, {}), ctx());
      assert.equal(o.decision, 'deny');
      assert.equal(o.reason, 'no path to evaluate');
      assert.equal(selected(o), 'r1');
    }
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

  it('shallow-merges object rawInput so a tracked command is used', () => {
    const filled = fillPermissionRequest(req('execute', { cwd: '/ws' }), {
      rawInput: { command: 'rm -rf build', cwd: '/other' },
    });
    assert.deepEqual(filled.toolCall.rawInput, {
      command: 'rm -rf build',
      cwd: '/ws',
    });
    const o = decidePermission(filled, ctx());
    assert.equal(o.decision, 'deny');
    assert.equal(o.proposedRule?.pattern, shellApprovalKey('rm -rf build'));
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

  it('server/tool rawInput without a flag is not an MCP approval', () => {
    const o = decidePermission(
      req('execute', { server: 'artificer-status', tool: 'report_status' }),
      ctx(),
    );
    assert.equal(o.tool, 'run_shell');
    assert.equal(o.decision, 'deny');
    assert.equal(o.reason, 'no command to evaluate');

    const other = decidePermission(
      req('other', { server: 'evil', tool: 'exfil' }),
      ctx(),
    );
    assert.equal(other.tool, 'acp:other');
  });

  it('unflagged execute with server/tool and a command is judged as shell', () => {
    const o = decidePermission(
      req('execute', {
        command: 'rm -rf build',
        server: 'artificer-status',
        tool: 'x',
      }),
      ctx(),
    );
    assert.equal(o.tool, 'run_shell');
    assert.equal(o.decision, 'deny');
    assert.equal(o.proposedRule?.pattern, shellApprovalKey('rm -rf build'));
  });

  it('flagged request with a command is judged as shell', () => {
    const o = decidePermission(
      {
        ...req('execute', {
          command: 'rm -rf build',
          server: 'artificer-status',
          tool: 'x',
        }),
        _meta: { is_mcp_tool_approval: true },
      },
      ctx(),
    );
    assert.equal(o.tool, 'run_shell');
    assert.equal(o.decision, 'deny');
    assert.equal(o.proposedRule?.pattern, shellApprovalKey('rm -rf build'));
  });

  it('edit with server/tool rawInput is path-checked', () => {
    const o = decidePermission(
      {
        ...req(
          'edit',
          { server: 'artificer-status', tool: 'report_status' },
          DEFAULT_OPTIONS,
          ['/etc/passwd'],
        ),
        _meta: { is_mcp_tool_approval: true },
      },
      ctx(),
    );
    assert.equal(o.tool, 'write_file');
    assert.equal(o.decision, 'deny');
    assert.match(o.reason ?? '', /path outside workspace/);
  });

  it('tracked is_mcp_tool_call flag alone marks MCP approval', () => {
    const tracked = fixture.mcpToolCallUpdate.update;
    const { _meta: _drop, ...unflagged } =
      fixture.mcpPermissionRequest as RequestPermissionRequest;
    const filled = fillPermissionRequest(unflagged, {
      title: tracked.title,
      kind: tracked.kind as ToolKind,
      rawInput: tracked.rawInput,
      _meta: tracked._meta,
    });
    assert.equal(filled._meta, undefined);
    assert.equal(filled.toolCall._meta?.is_mcp_tool_call, true);
    const o = decidePermission(filled, ctx());
    assert.equal(o.decision, 'allow');
    assert.equal(o.tool, 'mcp:artificer-status.report_status');
    assert.equal(optionOf(o), 'allow_once');
  });
});

describe('phase 3 final hardening', () => {
  it('tracked title is never used as the command', () => {
    const detailFree: RequestPermissionRequest = {
      sessionId: 's1',
      options: DEFAULT_OPTIONS,
      toolCall: { toolCallId: 't1' },
    };
    const filled = fillPermissionRequest(detailFree, {
      title: 'mcp.evil.exfil',
      kind: 'execute',
    });
    assert.equal(filled.toolCall.title, 'mcp.evil.exfil');
    const o = decidePermission(filled, ctx({ titleFromTracking: true }));
    assert.equal(o.decision, 'deny');
    assert.equal(o.reason, 'no command to evaluate');
    assert.equal(selected(o), 'r1');
  });

  it("the request's own title is still a command fallback", () => {
    const o = decidePermission(
      req('execute', undefined, undefined, undefined, 'ls'),
      ctx({ titleFromTracking: false }),
    );
    assert.equal(o.decision, 'allow');
    assert.equal(o.approvalKey, shellApprovalKey('ls'));
  });

  it('edit with no locations anywhere is denied after fill-in', () => {
    const filled = fillPermissionRequest(req('edit', {}), {
      kind: 'edit',
      locations: [],
    });
    const o = decidePermission(filled, ctx());
    assert.equal(o.decision, 'deny');
    assert.equal(o.reason, 'no path to evaluate');
  });

  const stateDir = '/var/artificer/exec/acp';
  it('execute that touches the state dir is denied', () => {
    for (const command of [
      `printf x >> ${stateDir}/codex-home/config.toml`,
      `cat ${stateDir}/codex-home/auth.json`,
    ]) {
      const o = decidePermission(
        req('execute', { command, cwd: '/ws' }),
        ctx({ protectedPaths: [stateDir] }),
      );
      assert.equal(o.decision, 'deny', command);
      assert.equal(o.reason, 'touches Artificer agent state');
      assert.equal(selected(o), 'r1');
    }
  });

  it('execute whose cwd is in the state dir is denied', () => {
    const o = decidePermission(
      req('execute', { command: 'printf x >> config.toml', cwd: stateDir }),
      ctx({ protectedPaths: [stateDir] }),
    );
    assert.equal(o.reason, 'touches Artificer agent state');
  });

  it('home-relative spellings of the state dir are denied', () => {
    const home = path.join(os.homedir(), '.artificer', 'acp');
    for (const command of [
      'printf x >> ~/.artificer/acp/codex-home/config.toml',
      'printf x >> $HOME/.artificer/acp/codex-home/config.toml',
      'printf x >> ${HOME}/.artificer/acp/codex-home/config.toml',
    ]) {
      const o = decidePermission(
        req('execute', { command }),
        ctx({ protectedPaths: [home] }),
      );
      assert.equal(o.reason, 'touches Artificer agent state', command);
    }
  });

  it('an edit inside the state dir is denied', () => {
    const o = decidePermission(
      req('edit', {}, undefined, [`${stateDir}/codex-home/AGENTS.md`]),
      ctx({ workspaceDir: stateDir + '/..', protectedPaths: [stateDir] }),
    );
    assert.equal(o.decision, 'deny');
    assert.equal(o.reason, 'touches Artificer agent state');
  });

  it('unrelated commands and writes are unaffected by protectedPaths', () => {
    const ok = decidePermission(
      req('execute', { command: 'printf hi > hello.txt', cwd: '/ws' }),
      ctx({ protectedPaths: [stateDir] }),
    );
    assert.equal(ok.decision, 'allow');
    const edit = decidePermission(
      req('edit', {}, undefined, ['/ws/a.txt']),
      ctx({ protectedPaths: [stateDir] }),
    );
    assert.equal(edit.decision, 'allow');
  });
});
