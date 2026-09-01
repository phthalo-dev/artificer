import type { RuntimeEvent } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import {
  fetchApprovalKey,
  matchRule,
  shellApprovalKey,
  type PolicyRule,
  type ToolPolicyFile,
} from './tool-policy.js';

export type ApprovalDeniedPayload = {
  ok: false;
  kind: 'approval_required' | 'approval_denied';
  tool: string;
  approvalKey: string;
  message: string;
  proposedRule: Omit<PolicyRule, 'id' | 'createdAt'>;
};

function approvalKeyFor(tool: string, input: Record<string, unknown>): string {
  if (tool === 'run_shell') {
    return shellApprovalKey(String(input.command ?? ''));
  }
  if (tool === 'fetch' || tool === 'fetch_url') {
    return fetchApprovalKey(
      String(input.method ?? 'GET'),
      String(input.url ?? ''),
    );
  }
  return '*';
}

function isGated(
  tool: Pick<ToolDef, 'needsApproval'>,
  input: Record<string, unknown>,
): boolean {
  const flag = tool.needsApproval;
  if (typeof flag === 'function') return flag(input);
  return flag === true;
}

export function enforceApproval(args: {
  tool: Pick<ToolDef, 'name' | 'needsApproval'>;
  input: Record<string, unknown>;
  policy: ToolPolicyFile;
  emit?: (event: RuntimeEvent) => void;
  runId?: string;
  workstreamId?: string;
}): { allow: true } | { allow: false; result: string } {
  if (!isGated(args.tool, args.input)) {
    return { allow: true };
  }

  const approvalKey = approvalKeyFor(args.tool.name, args.input);
  const matched = matchRule(args.policy, args.tool.name, approvalKey);
  const proposedRule: Omit<PolicyRule, 'id' | 'createdAt'> = {
    tool: args.tool.name,
    pattern: approvalKey,
    effect: 'allow',
    scope: 'agent',
  };

  if (matched?.effect === 'allow') {
    return { allow: true };
  }

  if (matched?.effect === 'deny') {
    const payload: ApprovalDeniedPayload = {
      ok: false,
      kind: 'approval_denied',
      tool: args.tool.name,
      approvalKey,
      message: `Policy denied ${args.tool.name} (${approvalKey}).`,
      proposedRule,
    };
    return { allow: false, result: JSON.stringify(payload) };
  }

  const payload: ApprovalDeniedPayload = {
    ok: false,
    kind: 'approval_required',
    tool: args.tool.name,
    approvalKey,
    message: `Approval required for ${args.tool.name} (${approvalKey}). Add an allow rule to proceed.`,
    proposedRule,
  };
  args.emit?.({
    kind: 'approval',
    at: new Date().toISOString(),
    data: {
      tool: args.tool.name,
      approvalKey,
      proposedRule,
      ...(args.runId ? { runId: args.runId } : {}),
      ...(args.workstreamId ? { workstreamId: args.workstreamId } : {}),
    },
  });
  return { allow: false, result: JSON.stringify(payload) };
}
