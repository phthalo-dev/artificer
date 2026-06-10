import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage } from 'ai';
import { DEFAULT_CALL_SAFETY } from './call-safety-config.js';
import {
  completionReminderText,
  plannerWritePlanReminderText,
} from './completion.js';
import { OUTDATED_FILE_CONTENT } from './message-sanitizer.js';
import {
  createStepHookContext,
  runPrepareStep,
} from './step-hooks.js';

function toolResultText(value: string) {
  return { type: 'text' as const, value };
}

function readFilePair(
  toolCallId: string,
  path: string,
  content: string,
): ModelMessage[] {
  return [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId,
          toolName: 'read_file',
          input: { path },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'read_file',
          output: toolResultText(content),
        },
      ],
    },
  ] as ModelMessage[];
}

test('runPrepareStep invalidates earlier read_file when same path re-read later', async () => {
  const ctx = createStepHookContext(DEFAULT_CALL_SAFETY, 'run-1');
  const path = 'src/foo.ts';

  let messages: ModelMessage[] = [
    { role: 'user', content: 'Read src/foo.ts' },
    ...readFilePair('a1', path, 'old content'),
  ];

  const first = await runPrepareStep(ctx, messages, 0, []);
  const firstResult = first.messages[2]!.content as Array<{ output: { value: string } }>;
  assert.equal(firstResult[0]!.output.value, 'old content');

  messages = [...messages, ...readFilePair('a2', path, 'new content')];

  const second = await runPrepareStep(ctx, messages, 1, []);
  const outdatedResult = second.messages[2]!.content as Array<{ output: { value: string } }>;
  assert.equal(outdatedResult[0]!.output.value, OUTDATED_FILE_CONTENT);
  const latestResult = second.messages[4]!.content as Array<{ output: { value: string } }>;
  assert.match(latestResult[0]!.output.value, /new content/);
});

test('runPrepareStep injects completion reminder at run start when required', async () => {
  const ctx = createStepHookContext(DEFAULT_CALL_SAFETY, 'run-completion');
  ctx.requireCompletionTool = true;
  ctx.completionToolName = 'declare_done';
  ctx.completionReminderAtStart = true;

  const messages: ModelMessage[] = [{ role: 'user', content: 'implement fix' }];
  const outcome = await runPrepareStep(ctx, messages, 0, []);

  assert.equal(outcome.messages.length, 2);
  assert.deepEqual(outcome.messages[1], {
    role: 'user',
    content: completionReminderText(),
  });
  assert.equal(ctx.completionReminderAtStart, false);
});

test('runPrepareStep injects pendingLoopWarning as user message', async () => {
  const ctx = createStepHookContext(DEFAULT_CALL_SAFETY, 'run-2');
  const warning = 'You may be repeating the same tool call.';
  ctx.pendingLoopWarning = warning;

  const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }];
  const outcome = await runPrepareStep(ctx, messages, 0, []);

  assert.equal(outcome.messages.length, 2);
  assert.deepEqual(outcome.messages[1], { role: 'user', content: warning });
  assert.equal(ctx.pendingLoopWarning, undefined);
});

test('runPrepareStep nudges planner to write_plan after exploration steps', async () => {
  const ctx = createStepHookContext(DEFAULT_CALL_SAFETY, 'run-planner');
  ctx.requireWritePlan = true;
  ctx.plannerWritePlanNudgeStep = 2;
  ctx.plannerWritePlanNudgeInterval = 2;

  const messages: ModelMessage[] = [{ role: 'user', content: 'plan the fix' }];
  const priorSteps = [
    { toolCalls: [{ toolName: 'grep' }] },
    { toolCalls: [{ toolName: 'read_file' }] },
  ];
  const outcome = await runPrepareStep(ctx, messages, 2, priorSteps);

  assert.equal(outcome.messages.length, 2);
  assert.deepEqual(outcome.messages[1], {
    role: 'user',
    content: plannerWritePlanReminderText(),
  });
});

test('runPrepareStep injects pending worker browse warning', async () => {
  const ctx = createStepHookContext(DEFAULT_CALL_SAFETY, 'run-worker');
  const warning = '[SYSTEM] Stop browsing and call edit_file.';
  ctx.pendingWorkerBrowseWarning = warning;

  const messages: ModelMessage[] = [{ role: 'user', content: 'implement' }];
  const outcome = await runPrepareStep(ctx, messages, 0, []);

  assert.equal(outcome.messages.length, 2);
  assert.deepEqual(outcome.messages[1], { role: 'user', content: warning });
  assert.equal(ctx.pendingWorkerBrowseWarning, undefined);
});

test('runPrepareStep repeats planner write_plan nudge every interval', async () => {
  const ctx = createStepHookContext(DEFAULT_CALL_SAFETY, 'run-planner');
  ctx.requireWritePlan = true;
  ctx.plannerWritePlanNudgeStep = 4;
  ctx.plannerWritePlanNudgeInterval = 4;

  const messages: ModelMessage[] = [{ role: 'user', content: 'plan the fix' }];
  const priorSteps = Array.from({ length: 8 }, () => ({
    toolCalls: [{ toolName: 'grep' }],
  }));

  const at4 = await runPrepareStep(ctx, messages, 4, priorSteps.slice(0, 4));
  assert.equal(at4.messages.at(-1)?.content, plannerWritePlanReminderText());

  const at8 = await runPrepareStep(ctx, messages, 8, priorSteps);
  assert.equal(at8.messages.at(-1)?.content, plannerWritePlanReminderText());
});

test('runPrepareStep returns abort outcome when abortReason is set', async () => {
  const ctx = createStepHookContext(DEFAULT_CALL_SAFETY, 'run-3');
  const reason = 'too many consecutive mistakes';
  ctx.abortReason = reason;

  const messages: ModelMessage[] = [
    { role: 'user', content: 'hello' },
    ...readFilePair('a1', 'src/bar.ts', 'content'),
  ];
  const outcome = await runPrepareStep(ctx, messages, 0, []);

  assert.equal(outcome.abortReason, reason);
  assert.equal(outcome.messages, messages);
  const firstResult = outcome.messages[2]!.content as Array<{ output: { value: string } }>;
  assert.equal(firstResult[0]!.output.value, 'content');
});
