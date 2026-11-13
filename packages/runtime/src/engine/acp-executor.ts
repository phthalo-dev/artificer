import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentRequestMethod,
  type AgentRequestParamsByMethod,
  type AgentRequestResponsesByMethod,
  type AuthMethod,
  type ClientContext,
  type StopReason,
  type ToolCallContent,
  type ToolKind,
  type ToolCallStatus,
} from '@agentclientprotocol/sdk';
import type { AcpExecutorConfig } from '../api/types.js';
import type { RuntimeEvent } from '../context.js';
import type { RunRecord, ToolInvocation } from '../storage/types.js';
import type { ToolPolicyFile } from '../tools/tool-policy.js';
import { decidePermission } from './acp-permissions.js';
import type { ExecutorResult, WorkerExecutor } from './executor.js';
import {
  executorStateDir,
  killProcessGroup,
  readExecutorStatus,
  trackAgentProcess,
} from './executor-files.js';

const MCP_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-status-server.mjs',
);
const STDERR_TAIL_BYTES = 64 * 1024;
const EXIT_GRACE_MS = 2_000;
const TERM_GRACE_MS = 1_000;
/** How long to wait for the exit event after the connection drops. */
const EXIT_SETTLE_MS = 1_000;
/** How long to wait for stderr to drain after the agent exits. */
const STDERR_DRAIN_MS = 500;
const MAX_TOOL_TEXT = 8 * 1024;
const TRUNCATED_SUFFIX = '…[truncated]';
const EMPTY_POLICY: ToolPolicyFile = { version: 1, rules: [] };
const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
};
const CLIENT_VERSION = readRuntimeVersion();

function readRuntimeVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function truncate(text: string): string {
  return text.length > MAX_TOOL_TEXT
    ? text.slice(0, MAX_TOOL_TEXT) + TRUNCATED_SUFFIX
    : text;
}

/** Keep raw tool input small; oversized input is replaced by its truncated JSON. */
function boundedInput(value: unknown): unknown {
  if (value === undefined) return undefined;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  if (json === undefined || json.length <= MAX_TOOL_TEXT) return value;
  return truncate(json);
}

function contentText(content: ToolCallContent[] | null | undefined): string {
  return (content ?? [])
    .map((item) =>
      item.type === 'content' && item.content.type === 'text'
        ? item.content.text
        : '',
    )
    .filter(Boolean)
    .join('\n');
}

interface TrackedToolCall {
  title?: string;
  kind?: ToolKind | null;
  status?: ToolCallStatus | null;
  rawInput?: unknown;
  output: string;
  reported: boolean;
}

/** Error whose message is already final and must not be re-wrapped. */
class AcpRunError extends Error {}

/**
 * Scan the agent's stdout and report the first line that is not JSON. The
 * SDK answers such lines with a parse error and carries on, which would turn
 * a banner-printing agent into a silent hang.
 */
function stdoutGuard(onInvalid: (line: string) => void) {
  const decoder = new TextDecoder();
  let pending = '';
  const check = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      JSON.parse(trimmed);
    } catch {
      onInvalid(trimmed);
    }
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) check(line);
    },
    flush() {
      check(pending + decoder.decode());
    },
  });
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, ms);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

export class AcpExecutor implements WorkerExecutor {
  readonly name: string;
  readonly resumesSession: boolean;
  private readonly mcpServerPath: string;

  constructor(
    private readonly config: AcpExecutorConfig,
    opts: { mcpServerPath?: string } = {},
  ) {
    this.name = 'acp:' + path.basename(config.command);
    this.resumesSession = config.resumes ?? false;
    this.mcpServerPath = opts.mcpServerPath ?? MCP_SERVER;
  }

  async execute({
    context,
    workspaceDir,
    run,
    policy,
    onToolCall,
    emit,
  }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
    sessionId?: string;
    signal?: AbortSignal;
    policy?: ToolPolicyFile;
    onToolCall?: (invocation: ToolInvocation) => void;
    emit?: (event: RuntimeEvent) => void;
  }): Promise<ExecutorResult> {
    const { config, name } = this;
    const statusFile = path.join(
      executorStateDir(workspaceDir),
      '.artificer-status.json',
    );
    fs.rmSync(statusFile, { force: true });

    const child = spawn(config.command, config.args, {
      cwd: workspaceDir,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });

    let stderrTail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf-8')).slice(
        -STDERR_TAIL_BYTES,
      );
    });
    const withStderr = (message: string) => {
      const tail = stderrTail.trim();
      return tail ? `${message}: ${tail}` : message;
    };
    // Writes after the agent dies surface as EPIPE; the exit handler reports.
    child.stdin.on('error', () => {});

    let promptDone = false;
    let failTransport!: (error: Error) => void;
    const transportFailure = new Promise<never>((_, reject) => {
      failTransport = reject;
    });
    transportFailure.catch(() => {});

    child.on('error', (err) => {
      failTransport(
        new AcpRunError(
          `${name} failed to start ${config.command}: ${err.message}`,
        ),
      );
    });
    // 'exit' can fire before stderr is drained. Wait for stderr to end, but
    // only briefly: a grandchild that inherited it can hold it open forever,
    // which is also why this does not use 'close'.
    let stderrEnded = false;
    child.stderr.once('end', () => {
      stderrEnded = true;
    });
    const stderrDrained = (): Promise<void> =>
      stderrEnded
        ? Promise.resolve()
        : new Promise((resolve) => {
            const timer = setTimeout(resolve, STDERR_DRAIN_MS);
            child.stderr.once('end', () => {
              clearTimeout(timer);
              resolve();
            });
          });
    child.on('exit', async (code, sig) => {
      if (promptDone) return;
      await stderrDrained();
      if (promptDone) return;
      const how = code !== null ? `code ${code}` : `signal ${sig}`;
      failTransport(new AcpRunError(withStderr(`${name} exited with ${how}`)));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        transportFailure.catch(reject);
      });
      trackAgentProcess(child);

      const input = (
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
      ).pipeThrough(
        stdoutGuard((line) =>
          failTransport(
            new AcpRunError(
              withStderr(
                `${name} wrote invalid JSON-RPC to stdout: ${JSON.stringify(line.slice(0, 200))}`,
              ),
            ),
          ),
        ),
      );
      const stream = ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        input,
      );

      let text = '';
      let activeSessionId: string | undefined;
      // Task 6's abort path flips this once session/cancel has been sent.
      const cancelling = false;
      const toolCalls = new Map<string, TrackedToolCall>();
      const track = (
        id: string,
        patch: {
          title?: string | null;
          kind?: ToolKind | null;
          status?: ToolCallStatus | null;
          rawInput?: unknown;
          content?: ToolCallContent[] | null;
        },
      ) => {
        const call = toolCalls.get(id) ?? { output: '', reported: false };
        toolCalls.set(id, call);
        if (patch.title != null) call.title = patch.title;
        if (patch.kind != null) call.kind = patch.kind;
        if (patch.status != null) call.status = patch.status;
        if (patch.rawInput !== undefined) call.rawInput = patch.rawInput;
        if (patch.content) {
          const out = contentText(patch.content);
          if (out) call.output = out;
        }
        if (
          !call.reported &&
          (call.status === 'completed' || call.status === 'failed')
        ) {
          call.reported = true;
          onToolCall?.({
            name: 'acp:' + (call.kind ?? 'other'),
            input: {
              title:
                call.title === undefined ? undefined : truncate(call.title),
              rawInput: boundedInput(call.rawInput),
            },
            output: truncate(call.output),
            ...(call.status === 'failed' ? { error: 'failed' } : {}),
            at: new Date().toISOString(),
          });
        }
      };
      const app = client({ name: 'artificer' })
        .onNotification(methods.client.session.update, ({ params }) => {
          if (params.sessionId !== activeSessionId) return;
          const update = params.update;
          if (
            update.sessionUpdate === 'agent_message_chunk' &&
            update.content.type === 'text'
          ) {
            text += update.content.text;
          } else if (
            update.sessionUpdate === 'tool_call' ||
            update.sessionUpdate === 'tool_call_update'
          ) {
            track(update.toolCallId, update);
          }
        })
        .onRequest(methods.client.session.requestPermission, ({ params }) => {
          const outcome = decidePermission(params, {
            role: run.role,
            workspaceDir,
            policy: policy ?? EMPTY_POLICY,
            cancelling,
          });
          const at = new Date().toISOString();
          if (outcome.proposedRule) {
            emit?.({
              kind: 'approval',
              at,
              data: {
                tool: outcome.tool,
                approvalKey: outcome.approvalKey,
                proposedRule: outcome.proposedRule,
                runId: run.id,
                ...(run.workstreamId ? { workstreamId: run.workstreamId } : {}),
              },
            });
          }
          const detail =
            outcome.decision +
            (outcome.ruleId ? ' ' + outcome.ruleId : '') +
            (outcome.reason ? ': ' + outcome.reason : '');
          emit?.({
            kind: 'tool',
            at,
            data: {
              runId: run.id,
              name: 'acp:permission',
              input: {
                tool: outcome.tool,
                approvalKey: truncate(outcome.approvalKey),
              },
              output: detail,
              at,
            },
          });
          return outcome.response;
        });

      const session = app.connectWith(stream, async (ctx) => {
        const init = await this.call(ctx, methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: CLIENT_CAPABILITIES,
          clientInfo: { name: 'artificer', version: CLIENT_VERSION },
        });
        const authMethods: AuthMethod[] = init.authMethods ?? [];

        let created;
        try {
          created = await ctx.request(methods.agent.session.new, {
            cwd: workspaceDir,
            mcpServers: [
              {
                name: 'artificer-status',
                command: process.execPath,
                args: [this.mcpServerPath, statusFile],
                env: [],
              },
            ],
          });
        } catch (err) {
          if (
            err instanceof RequestError &&
            authMethods.length > 0 &&
            (/auth/i.test(err.message) || err.code === -32000)
          ) {
            throw new AcpRunError(
              `${name} is not signed in on this host: ${authMethods
                .map((m) => m.name)
                .join(', ')}`,
            );
          }
          throw this.wrap(methods.agent.session.new, err);
        }
        const sessionId = created.sessionId;
        activeSessionId = sessionId;

        if (
          config.mode &&
          created.modes?.availableModes.some((m) => m.id === config.mode)
        ) {
          await this.call(ctx, methods.agent.session.setMode, {
            sessionId,
            modeId: config.mode,
          });
        }

        const response = await this.call(ctx, methods.agent.session.prompt, {
          sessionId,
          prompt: [{ type: 'text', text: context }],
        });
        promptDone = true;
        return { sessionId, stopReason: response.stopReason };
      });

      let outcome: { sessionId: string; stopReason: StopReason };
      try {
        outcome = await Promise.race([session, transportFailure]);
      } catch (err) {
        // A dropped connection usually means the agent died. Let the exit
        // event, which carries the code and stderr, win that race.
        if (!(err instanceof AcpRunError)) {
          let settle: ReturnType<typeof setTimeout> | undefined;
          try {
            // Rejects with the exit error if it arrives in time.
            await Promise.race([
              transportFailure,
              new Promise((resolve) => {
                settle = setTimeout(resolve, EXIT_SETTLE_MS + STDERR_DRAIN_MS);
              }),
            ]);
          } finally {
            clearTimeout(settle);
          }
        }
        throw err;
      }
      promptDone = true;

      if (outcome.stopReason === 'cancelled') throw new Error('cancelled');
      let resultText = text || '(no output)';
      if (outcome.stopReason !== 'end_turn') {
        resultText += `\n\n[agent stopped: ${outcome.stopReason}]`;
      }

      await this.shutdown(child);
      return {
        text: resultText,
        sessionId: outcome.sessionId,
        usage: { inputTokens: 0, outputTokens: 0 },
        ...readExecutorStatus(statusFile),
      };
    } finally {
      killProcessGroup(child, 'SIGKILL');
    }
  }

  /** Close stdin, then escalate to SIGTERM and SIGKILL if the agent lingers. */
  private async shutdown(child: ChildProcess): Promise<void> {
    child.stdin?.end();
    if (await waitForExit(child, EXIT_GRACE_MS)) return;
    killProcessGroup(child, 'SIGTERM');
    if (await waitForExit(child, TERM_GRACE_MS)) return;
    killProcessGroup(child, 'SIGKILL');
  }

  private async call<M extends AgentRequestMethod>(
    ctx: ClientContext,
    method: M,
    params: AgentRequestParamsByMethod[M],
  ): Promise<AgentRequestResponsesByMethod[M]> {
    try {
      return await ctx.request(method, params);
    } catch (err) {
      throw this.wrap(method, err);
    }
  }

  private wrap(method: string, err: unknown): Error {
    if (err instanceof RequestError) {
      return new AcpRunError(`${this.name} ${method} failed: ${err.message}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
