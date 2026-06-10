import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSummaryRequest,
  SUMMARY_PREFIX,
  wrapCompactionSummary,
} from './agentic-compact.js';

test('wrapCompactionSummary adds reference-only prefix', () => {
  const out = wrapCompactionSummary('## Goal\nFix flask');
  assert.ok(out.startsWith(SUMMARY_PREFIX.slice(0, 40)));
  assert.match(out, /Fix flask/);
});

test('buildSummaryRequest includes goal and prior summary', () => {
  const req = buildSummaryRequest({
    workstream: { title: 'Flask', goal: 'fix dotted names' },
    planExcerpt: 'step 1',
    runsText: 'run history',
    priorSummary: 'old summary',
    fileOpsLedger: '<read-files>\nsrc/a.py\n</read-files>',
  });
  assert.match(req, /fix dotted names/);
  assert.match(req, /old summary/);
  assert.match(req, /run history/);
  assert.match(req, /src\/a.py/);
});
