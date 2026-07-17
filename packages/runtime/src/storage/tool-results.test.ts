import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Layout } from './layout.js';
import {
  applyResultBudget,
  readSpilledResult,
  spillToolResult,
} from './tool-results.js';

test('spill writes file and returns preview with path', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-tool-results-test-'),
  );
  try {
    const layout = new Layout(dir);
    const { output, spillPath } = await spillToolResult({
      layout,
      runId: 'run_1',
      index: 0,
      toolName: 'run_shell',
      body: 'x'.repeat(20_000),
      maxChars: 1000,
    });
    assert.ok(output.includes('[spilled'));
    assert.ok(output.includes('read_tool_result'));
    assert.ok(spillPath);
    const full = await fs.readFile(spillPath, 'utf8');
    assert.equal(full.length, 20_000);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('readSpilledResult rejects path escape', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-tool-results-test-'),
  );
  try {
    const layout = new Layout(dir);
    await assert.rejects(
      () => readSpilledResult(layout, 'run_1', '../outside.txt'),
      /not allowed|outside tool-results directory/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('applyResultBudget spills when per-invocation cap exceeded', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-tool-results-test-'),
  );
  try {
    const layout = new Layout(dir);
    const body = 'y'.repeat(5000);
    const result = await applyResultBudget({
      layout,
      runId: 'run_2',
      index: 1,
      toolName: 'grep',
      body,
      maxPerInvocation: 500,
      maxPerRun: 80_000,
      runTotalChars: 0,
    });
    assert.ok(result.output.includes('[spilled'));
    assert.ok(result.spillPath);
    assert.equal(result.runTotalChars, 500);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('applyResultBudget hard-truncates when per-run budget exceeded', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-tool-results-test-'),
  );
  try {
    const layout = new Layout(dir);
    const body = 'z'.repeat(2000);
    const result = await applyResultBudget({
      layout,
      runId: 'run_3',
      index: 0,
      toolName: 'read_file',
      body,
      maxPerInvocation: 5000,
      maxPerRun: 100,
      runTotalChars: 50,
    });
    assert.ok(result.output.includes('truncated'));
    assert.equal(result.runTotalChars, 100);
    assert.equal(result.spillPath, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
