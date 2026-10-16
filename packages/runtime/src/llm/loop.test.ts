import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { RuntimeEvent } from '../context.js';
import type { ToolDef } from './types.js';
import type { ToolPolicyFile } from '../tools/tool-policy.js';
import { runToolLoop } from './loop.js';

function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    warnings: [],
  };
}

test('runToolLoop marks the system prompt as an ephemeral cache breakpoint', async () => {
  const model = new MockLanguageModelV3({ doGenerate: textResult('done') });

  await runToolLoop({
    model,
    system: 'You are a helpful assistant.',
    userMessage: 'hello',
    tools: [],
    maxIterations: 1,
  });

  const [call] = model.doGenerateCalls;
  const systemMessage = call.prompt.find((m) => m.role === 'system');
  assert.ok(systemMessage, 'expected a system message in the prompt');
  assert.deepEqual(
    (systemMessage as { providerOptions?: unknown }).providerOptions,
    { anthropic: { cacheControl: { type: 'ephemeral' } } },
  );
});

test('runToolLoop forwards reasoning providerOptions for kimi-k3', async () => {
  const model = new MockLanguageModelV3({ doGenerate: textResult('done') });

  await runToolLoop({
    model,
    modelId: 'kimi-k3',
    system: 'You are helpful.',
    userMessage: 'hello',
    tools: [],
    maxIterations: 1,
  });

  const [call] = model.doGenerateCalls;
  const opts = (call as { providerOptions?: Record<string, unknown> })
    .providerOptions;
  assert.ok(opts);
  assert.ok(JSON.stringify(opts).includes('reasoning'));
});

function toolCallThenText(toolName: string, input: Record<string, unknown>) {
  let calls = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'call_1',
              toolName,
              input: JSON.stringify(input),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
          usage: textResult('').usage,
          warnings: [],
        };
      }
      return textResult('done');
    },
  });
}

function gatedDef(handler: ToolDef['handler']): ToolDef {
  return {
    name: 'gated',
    description: 'needs approval',
    inputSchema: { type: 'object', properties: {} },
    needsApproval: true,
    handler,
  };
}

const EMPTY_POLICY: ToolPolicyFile = { version: 1, rules: [] };

test('runToolLoop blocks needsApproval tools without an allow rule', async () => {
  let called = false;
  const events: RuntimeEvent[] = [];
  const result = await runToolLoop({
    model: toolCallThenText('gated', {}),
    system: 'You are helpful.',
    userMessage: 'go',
    tools: [
      gatedDef(async () => {
        called = true;
        return 'ran';
      }),
    ],
    maxIterations: 5,
    policy: EMPTY_POLICY,
    emit: (event) => events.push(event),
    runId: 'run_1',
  });

  assert.equal(called, false);
  assert.equal(result.toolCalls.length, 1);
  const payload = JSON.parse(result.toolCalls[0]!.output) as {
    kind: string;
  };
  assert.equal(payload.kind, 'approval_required');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'approval');
});

test('runToolLoop runs the handler when an allow rule matches', async () => {
  let called = false;
  const result = await runToolLoop({
    model: toolCallThenText('gated', {}),
    system: 'You are helpful.',
    userMessage: 'go',
    tools: [
      gatedDef(async () => {
        called = true;
        return 'ran';
      }),
    ],
    maxIterations: 5,
    policy: {
      version: 1,
      rules: [
        {
          id: 'allow-1',
          tool: 'gated',
          pattern: '*',
          effect: 'allow',
          scope: 'agent',
          createdAt: '2026-08-25T00:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(called, true);
  assert.equal(result.toolCalls[0]?.output, 'ran');
});

test('runToolLoop returns approval_denied without emitting', async () => {
  let called = false;
  const events: RuntimeEvent[] = [];
  const result = await runToolLoop({
    model: toolCallThenText('gated', {}),
    system: 'You are helpful.',
    userMessage: 'go',
    tools: [
      gatedDef(async () => {
        called = true;
        return 'ran';
      }),
    ],
    maxIterations: 5,
    policy: {
      version: 1,
      rules: [
        {
          id: 'deny-1',
          tool: 'gated',
          pattern: '*',
          effect: 'deny',
          scope: 'agent',
          createdAt: '2026-08-25T00:00:00.000Z',
        },
      ],
    },
    emit: (event) => events.push(event),
  });

  assert.equal(called, false);
  const payload = JSON.parse(result.toolCalls[0]!.output) as {
    kind: string;
  };
  assert.equal(payload.kind, 'approval_denied');
  assert.equal(events.length, 0);
});

test('runToolLoop stops between iterations when its signal aborts', async () => {
  const controller = new AbortController();
  const model = toolCallThenText('stop_me', {});
  await assert.rejects(
    runToolLoop({
      model,
      system: 'You are helpful.',
      userMessage: 'go',
      tools: [
        {
          name: 'stop_me',
          description: 'aborts the call',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            controller.abort();
            return 'stopped';
          },
        },
      ],
      maxIterations: 5,
      signal: controller.signal,
    }),
    /cancelled/,
  );
  assert.equal(model.doGenerateCalls.length, 1);
});
