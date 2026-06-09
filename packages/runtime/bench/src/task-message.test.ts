import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDeepSweTaskBody } from './task-message.js';
import type { BenchInstance } from './types.js';

const instance: BenchInstance = {
  instance_id: 'test-task',
  repo: 'org/repo',
  base_commit: 'abc123',
  problem_statement: 'Implement feature X.',
  suite: 'deepswe',
};

describe('buildDeepSweTaskBody', () => {
  it('includes workflow and patch discipline for preflight mode', () => {
    const body = buildDeepSweTaskBody(instance, { preflight: true });
    assert.ok(body.includes('Recommended workflow'));
    assert.ok(body.includes('Patch discipline'));
    assert.ok(body.includes('repo/'));
    assert.ok(body.includes('Implement feature X.'));
  });

  it('notes docker execution for docker bootstrap mode', () => {
    const body = buildDeepSweTaskBody(instance, { preflight: true, docker: true });
    assert.ok(body.includes('evaluator image'));
    assert.ok(body.includes('run_shell'));
  });
});
