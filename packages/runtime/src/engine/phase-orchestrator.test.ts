import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldInvokePhaseOrchestrator } from './phase-orchestrator.js';

const BENCH_GOAL = `--- WORKSTREAM ---
repoUrl: https://github.com/pallets/flask
baseCommit: abc123
title: flask task
---

Fix the bug described below.`;

test('never invokes orchestrator for planning phase', () => {
  assert.equal(shouldInvokePhaseOrchestrator(BENCH_GOAL, 'planning'), false);
  assert.equal(
    shouldInvokePhaseOrchestrator('x'.repeat(600), 'planning'),
    false,
  );
});

test('skips orchestrator for typical short repo/bench tasks', () => {
  assert.equal(shouldInvokePhaseOrchestrator(BENCH_GOAL, 'implementing'), false);
});

test('invokes orchestrator for long repo/bench tasks', () => {
  assert.equal(
    shouldInvokePhaseOrchestrator(`${BENCH_GOAL}\n${'detail line.\n'.repeat(200)}`, 'implementing'),
    true,
  );
});

test('invokes orchestrator for long non-repo implementing tasks', () => {
  assert.equal(
    shouldInvokePhaseOrchestrator('x'.repeat(900), 'implementing'),
    true,
  );
});

test('skips orchestrator for short non-repo implementing tasks', () => {
  assert.equal(
    shouldInvokePhaseOrchestrator('Fix the typo in README', 'implementing'),
    false,
  );
});

test('invokes orchestrator when goal mentions design or architecture', () => {
  assert.equal(
    shouldInvokePhaseOrchestrator('design a new API layer', 'implementing'),
    true,
  );
  assert.equal(
    shouldInvokePhaseOrchestrator('architect a migration plan', 'implementing'),
    true,
  );
});
