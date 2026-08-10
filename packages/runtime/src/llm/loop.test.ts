import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
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
