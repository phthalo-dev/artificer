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

export type ApprovalDecision =
  | { allow: true; rule?: PolicyRule }
  | {
      allow: false;
      kind: 'approval_denied';
      rule: PolicyRule;
      proposedRule: Omit<PolicyRule, 'id' | 'createdAt'>;
    }
  | {
      allow: false;
      kind: 'approval_required';
      proposedRule: Omit<PolicyRule, 'id' | 'createdAt'>;
    };

/** Pure policy decision for a call already known to be gated. */
export function decideApproval(args: {
  tool: string;
  approvalKey: string;
  policy: ToolPolicyFile;
}): ApprovalDecision {
  const matched = matchRule(args.policy, args.tool, args.approvalKey);
  const proposedRule: Omit<PolicyRule, 'id' | 'createdAt'> = {
    tool: args.tool,
    pattern: args.approvalKey,
    effect: 'allow',
    scope: 'agent',
  };
  if (matched?.effect === 'allow') return { allow: true, rule: matched };
  if (matched?.effect === 'deny') {
    return {
      allow: false,
      kind: 'approval_denied',
      rule: matched,
      proposedRule,
    };
  }
  return { allow: false, kind: 'approval_required', proposedRule };
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
  const decision = decideApproval({
    tool: args.tool.name,
    approvalKey,
    policy: args.policy,
  });

  if (decision.allow) {
    return { allow: true };
  }

  const { proposedRule } = decision;

  if (decision.kind === 'approval_denied') {
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
