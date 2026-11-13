import path from 'node:path';
import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolKind,
} from '@agentclientprotocol/sdk';
import type { RoleName } from '../storage/types.js';
import { decideApproval } from '../tools/approval.js';
import {
  checkGitCloneInWorkspace,
  checkGitStash,
  checkReviewerWrite,
} from '../tools/shell-policy.js';
import {
  fetchApprovalKey,
  isDangerousShellCommand,
  shellApprovalKey,
  type PolicyRule,
  type ToolPolicyFile,
} from '../tools/tool-policy.js';

export interface PermissionContext {
  role: string;
  workspaceDir: string;
  policy: ToolPolicyFile;
  cancelling: boolean;
}

export interface PermissionOutcome {
  response: RequestPermissionResponse;
  decision: 'allow' | 'deny';
  tool: string;
  approvalKey: string;
  ruleId?: string;
  reason?: string;
  proposedRule?: Omit<PolicyRule, 'id' | 'createdAt'>;
}

const WRITE_KINDS: ReadonlySet<ToolKind> = new Set(['edit', 'delete', 'move']);
const SAFE_METHODS = new Set(['GET', 'HEAD']);

const CANCELLED: RequestPermissionResponse = {
  outcome: { outcome: 'cancelled' },
};

function pickOption(
  options: PermissionOption[],
  kind: 'allow_once' | 'reject_once',
): PermissionOption | undefined {
  return options.find((o) => o.kind === kind);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function commandOf(rawInput: unknown, title: string | null | undefined) {
  const command = asRecord(rawInput).command;
  if (typeof command === 'string' && command.length > 0) return command;
  if (Array.isArray(command) && command.length > 0) {
    return command.map(String).join(' ');
  }
  return title ?? '';
}

function deny(
  req: RequestPermissionRequest,
  base: Pick<PermissionOutcome, 'tool' | 'approvalKey'> &
    Partial<PermissionOutcome>,
): PermissionOutcome {
  const reject = pickOption(req.options, 'reject_once');
  return {
    ...base,
    decision: 'deny',
    response: reject
      ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
      : CANCELLED,
  };
}

function allow(
  req: RequestPermissionRequest,
  base: Pick<PermissionOutcome, 'tool' | 'approvalKey'> &
    Partial<PermissionOutcome>,
): PermissionOutcome {
  const opt = pickOption(req.options, 'allow_once');
  if (!opt) {
    return deny(req, { ...base, reason: 'no allow_once option' });
  }
  return {
    ...base,
    decision: 'allow',
    response: { outcome: { outcome: 'selected', optionId: opt.optionId } },
  };
}

function gated(
  req: RequestPermissionRequest,
  ctx: PermissionContext,
  tool: string,
  approvalKey: string,
): PermissionOutcome {
  const d = decideApproval({ tool, approvalKey, policy: ctx.policy });
  if (d.allow) return allow(req, { tool, approvalKey, ruleId: d.rule?.id });
  return deny(req, {
    tool,
    approvalKey,
    proposedRule: d.kind === 'approval_required' ? d.proposedRule : undefined,
    ruleId: d.kind === 'approval_denied' ? d.rule.id : undefined,
  });
}

/** Map an ACP session/request_permission onto Artificer's tool policy. */
export function decidePermission(
  req: RequestPermissionRequest,
  ctx: PermissionContext,
): PermissionOutcome {
  const call = req.toolCall;
  const kind: ToolKind = call.kind ?? 'other';

  if (ctx.cancelling) {
    return {
      response: CANCELLED,
      decision: 'deny',
      tool: `acp:${kind}`,
      approvalKey: '',
      reason: 'cancelled',
    };
  }

  if (kind === 'execute') {
    const command = commandOf(call.rawInput, call.title);
    const approvalKey = shellApprovalKey(command);
    const tool = 'run_shell';
    const reviewerWrite = checkReviewerWrite(command, ctx.role as RoleName);
    if (!reviewerWrite.allowed) {
      return deny(req, { tool, approvalKey, reason: reviewerWrite.reason });
    }
    const stash = checkGitStash(command, ctx.role as RoleName);
    if (!stash.allowed) {
      return deny(req, { tool, approvalKey, reason: stash.reason });
    }
    const clone = checkGitCloneInWorkspace(
      command,
      ctx.workspaceDir,
      ctx.workspaceDir,
    );
    if (!clone.allowed) {
      return deny(req, { tool, approvalKey, reason: clone.reason });
    }
    if (!isDangerousShellCommand(command)) {
      return allow(req, { tool, approvalKey });
    }
    return gated(req, ctx, tool, approvalKey);
  }

  if (kind === 'fetch') {
    const input = asRecord(call.rawInput);
    const method = String(input.method ?? 'GET').toUpperCase();
    const approvalKey = fetchApprovalKey(method, String(input.url ?? ''));
    const tool = 'fetch_url';
    if (SAFE_METHODS.has(method)) return allow(req, { tool, approvalKey });
    return gated(req, ctx, tool, approvalKey);
  }

  if (WRITE_KINDS.has(kind)) {
    const tool = 'write_file';
    const paths = (call.locations ?? []).map((l) => l.path);
    const approvalKey = paths.join(', ');
    if (ctx.role === 'reviewer') {
      return deny(req, {
        tool,
        approvalKey,
        reason: 'reviewer role is read-only',
      });
    }
    const root = path.resolve(ctx.workspaceDir);
    const outside = paths.find((p) => {
      const rel = path.relative(root, path.resolve(ctx.workspaceDir, p));
      return (
        rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
      );
    });
    if (outside !== undefined) {
      return deny(req, {
        tool,
        approvalKey,
        reason: `path outside workspace: ${outside}`,
      });
    }
    return allow(req, { tool, approvalKey });
  }

  return allow(req, { tool: `acp:${kind}`, approvalKey: '' });
}
