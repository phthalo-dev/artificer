import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLlmJudgePrompt,
  gradeLlmJudge,
  parseLlmJudgeVerdict,
} from './grade-llm-judge.js';

test('parseLlmJudgeVerdict reads the last PASS/FAIL line', () => {
  assert.equal(parseLlmJudgeVerdict('looks good\nPASS'), true);
  assert.equal(parseLlmJudgeVerdict('missing the preset\nFAIL'), false);
  assert.equal(parseLlmJudgeVerdict('pass'), true);
  assert.equal(parseLlmJudgeVerdict('unclear'), false);
});

test('gradeLlmJudge sends the rubric and material to complete', async () => {
  let prompt = '';
  const resolved = await gradeLlmJudge({
    rubric: 'Must mention the preset.',
    material: 'The preset is go-economy.',
    complete: async (text) => {
      prompt = text;
      return 'The agent named the preset.\nPASS';
    },
  });
  assert.equal(resolved, true);
  assert.match(prompt, /Must mention the preset/);
  assert.match(prompt, /go-economy/);
  assert.match(buildLlmJudgePrompt('r', 'm'), /Last line must be PASS or FAIL/);
});
