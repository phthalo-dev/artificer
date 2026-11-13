import path from 'node:path';
import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolCallLocation,
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

/** The tool call fields the executor tracks from session/update. */
export interface TrackedPermissionFields {
  title?: string | null;
  kind?: ToolKind | null;
  rawInput?: unknown;
  locations?: ToolCallLocation[] | null;
  /** `_meta` of the agent's tool_call / tool_call_update notifications. */
  _meta?: Record<string, unknown> | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Merge the tool call tracked under the request's toolCallId into the
 * request. Agents such as Codex send detail-free permission requests and put
 * the title, kind and input on the earlier tool_call update. A field is
 * copied only when the request's own field is missing, null or empty. When
 * both rawInputs are objects they are shallow-merged, request keys winning,
 * so a request that omits `command` is still judged on the tracked one. The
 * tracked `_meta` is merged under the request's `toolCall._meta` (request
 * keys winning); the request's top-level `_meta` passes through unchanged.
 */
export function fillPermissionRequest(
  req: RequestPermissionRequest,
  tracked: TrackedPermissionFields | undefined,
): RequestPermissionRequest {
  if (!tracked) return req;
  const toolCall = { ...req.toolCall };
  if (isEmpty(toolCall.title) && !isEmpty(tracked.title)) {
    toolCall.title = tracked.title;
  }
  if (isEmpty(toolCall.kind) && !isEmpty(tracked.kind)) {
    toolCall.kind = tracked.kind;
  }
  if (isPlainObject(toolCall.rawInput) && isPlainObject(tracked.rawInput)) {
    toolCall.rawInput = { ...tracked.rawInput, ...toolCall.rawInput };
  } else if (isEmpty(toolCall.rawInput) && !isEmpty(tracked.rawInput)) {
    toolCall.rawInput = tracked.rawInput;
  }
  if (isEmpty(toolCall.locations) && !isEmpty(tracked.locations)) {
    toolCall.locations = tracked.locations;
  }
  if (isPlainObject(tracked._meta)) {
    toolCall._meta = {
      ...tracked._meta,
      ...(isPlainObject(toolCall._meta) ? toolCall._meta : {}),
    };
  }
  return { ...req, toolCall };
}

const STATUS_SERVER = 'artificer-status';

function decideMcp(
  req: RequestPermissionRequest,
  ctx: PermissionContext,
  input: Record<string, unknown>,
): PermissionOutcome {
  const { server, tool } = input;
  if (
    typeof server !== 'string' ||
    typeof tool !== 'string' ||
    server.length === 0 ||
    tool.length === 0
  ) {
    return deny(req, {
      tool: 'mcp:unknown',
      approvalKey: '',
      reason: 'unknown MCP server',
    });
  }
  const approvalKey = `${server}.${tool}`;
  const name = `mcp:${approvalKey}`;
  if (server === STATUS_SERVER) return allow(req, { tool: name, approvalKey });
  return gated(req, ctx, name, approvalKey);
}

/**
 * An MCP approval is identified only by the adapter's explicit flag: the
 * request's `_meta.is_mcp_tool_approval` or the tracked tool call's
 * `_meta.is_mcp_tool_call`. A request that carries a shell command or is a
 * write kind is never classified as MCP, so it keeps its normal checks.
 */
function isMcpApproval(req: RequestPermissionRequest, kind: ToolKind): boolean {
  const call = req.toolCall;
  const flagged =
    req._meta?.is_mcp_tool_approval === true ||
    call._meta?.is_mcp_tool_call === true;
  if (!flagged || WRITE_KINDS.has(kind)) return false;
  const command = asRecord(call.rawInput).command;
  return !(
    (typeof command === 'string' && command.length > 0) ||
    (Array.isArray(command) && command.length > 0)
  );
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

  const input = asRecord(call.rawInput);
  if (isMcpApproval(req, kind)) return decideMcp(req, ctx, input);

  if (kind === 'execute') {
    const command = commandOf(call.rawInput, call.title);
    const approvalKey = shellApprovalKey(command);
    const tool = 'run_shell';
    if (command.trim().length === 0) {
      return deny(req, { tool, approvalKey, reason: 'no command to evaluate' });
    }
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
