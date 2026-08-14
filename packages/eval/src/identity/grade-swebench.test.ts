import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { EvalTaskResult } from '../types.js';
import {
  applySweBenchReport,
  predictionsFromResults,
  writePredictionsJsonl,
} from './grade-swebench.js';

function result(
  instanceId: string,
  patch: string,
  outcome: EvalTaskResult['outcome'] = 'submitted',
): EvalTaskResult {
  return {
    instanceId,
    outcome,
    durationMs: 1,
    outboundMessages: [],
    patch,
  };
}

test('predictionsFromResults writes model_patch per instance', () => {
  const predictions = predictionsFromResults(
    [result('a', 'diff --git a/x')],
    'go-economy',
  );
  assert.deepEqual(predictions, [
    {
      instance_id: 'a',
      model_name_or_path: 'go-economy',
      model_patch: 'diff --git a/x',
    },
  ]);
});

test('writePredictionsJsonl writes one JSON object per line', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'swebench-pred-'));
  try {
    const file = await writePredictionsJsonl(dir, [
      {
        instance_id: 'a',
        model_name_or_path: 'm',
        model_patch: 'p',
      },
    ]);
    const raw = await fs.readFile(file, 'utf8');
    assert.equal(
      raw.trim(),
      JSON.stringify({
        instance_id: 'a',
        model_name_or_path: 'm',
        model_patch: 'p',
      }),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('applySweBenchReport marks resolved ids and empty patches', () => {
  const updated = applySweBenchReport(
    [
      result('pass-me', 'diff'),
      result('fail-me', 'diff'),
      result('empty', ''),
      { ...result('timed', 'diff'), outcome: 'timeout', resolved: false },
    ],
    {
      resolved_ids: ['pass-me'],
      empty_patch_ids: ['empty'],
    },
  );
  assert.equal(updated[0]?.resolved, true);
  assert.equal(updated[1]?.resolved, false);
  assert.equal(updated[2]?.resolved, false);
  assert.equal(updated[3]?.outcome, 'timeout');
});
