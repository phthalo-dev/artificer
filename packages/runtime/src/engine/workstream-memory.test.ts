import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { IdentityStore } from '../storage/identity-store.js';
import { Store } from '../storage/store.js';
import { WorkstreamMemoryService } from './workstream-memory.js';
import type { Workstream, RunRecord, Review } from '../storage/types.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-wm-'));
}

function makeWorkstream(overrides: Partial<Workstream> = {}): Workstream {
  return {
    id: 'ws_test01',
    title: 'Fix the login bug',
    goal: 'Users cannot log in on mobile — trace and fix the root cause.',
    status: 'pending',
    summary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeWorkerRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run_abc',
    role: 'worker',
    task: 'Implement the fix',
    status: 'done',
    toolCalls: [],
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 1,
    },
    output: 'Fixed the auth middleware. Changed token validation logic.',
    workstreamId: 'ws_test01',
    createdAt: '2026-01-01T01:00:00.000Z',
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'rev_abc',
    workstreamId: 'ws_test01',
    target: 'implementation',
    notes: 'Looks good — tests pass and the fix is minimal.',
    approved: true,
    stage: 'work',
    severity: 'none',
    createdAt: '2026-01-01T02:00:00.000Z',
    ...overrides,
  };
}

describe('WorkstreamMemoryService', () => {
  let rootDir: string;
  let dataDir: string;
  let identity: IdentityStore;
  let store: Store;
  let svc: WorkstreamMemoryService;

  beforeEach(async () => {
    rootDir = tmpDir();
    dataDir = tmpDir();
    identity = new IdentityStore(rootDir);
    await identity.init();
    store = new Store(dataDir);
    await store.init();
    svc = new WorkstreamMemoryService(identity, store);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates a memory when a workstream is created', async () => {
    const ws = makeWorkstream();
    await svc.onCreated(ws);

    const memories = await identity.listMemories();
    assert.equal(memories.length, 1);
    assert.equal(memories[0].title, 'Fix the login bug');
    assert.ok(memories[0].content.includes('Users cannot log in on mobile'));
    assert.ok(memories[0].tags.includes('workstream'));
    assert.equal(memories[0].kind, 'document');
    assert.ok(memories[0].source?.includes('ws_test01'));
  });

  it('saves the memory id to a sidecar file', async () => {
    const ws = makeWorkstream();
    await svc.onCreated(ws);

    const memories = await identity.listMemories();
    const memId = memories[0].id;

    const refFile = store.layout.workstreamMemoryRefFile('ws_test01');
    const saved = fs.readFileSync(refFile, 'utf-8').trim();
    assert.equal(saved, memId);
  });

  it('appends plan section when plan is written', async () => {
    const ws = makeWorkstream();
    await svc.onCreated(ws);

    await svc.onPlanWritten(
      ws,
      '## Steps\n1. Trace the bug\n2. Fix it\n3. Test',
    );

    const memories = await identity.listMemories();
    assert.equal(memories.length, 1);
    assert.ok(memories[0].content.includes('## Plan'));
    assert.ok(memories[0].content.includes('Trace the bug'));
  });

  it('appends worker run section when worker finishes', async () => {
    const ws = makeWorkstream();
    await svc.onCreated(ws);

    const run = makeWorkerRun();
    await svc.onWorkerRunFinished(ws, run);

    const memories = await identity.listMemories();
    assert.ok(memories[0].content.includes('## Worker Run'));
    assert.ok(memories[0].content.includes('Fixed the auth middleware'));
  });

  it('appends review section when review completes', async () => {
    const ws = makeWorkstream();
    await svc.onCreated(ws);

    const review = makeReview();
    await svc.onReviewCompleted(ws, review);

    const memories = await identity.listMemories();
    assert.ok(memories[0].content.includes('## Review'));
    assert.ok(memories[0].content.includes('approved'));
    assert.ok(memories[0].content.includes('Looks good'));
  });

  it('appends outcome section and updates summary when workstream reaches terminal state', async () => {
    const ws = makeWorkstream({
      status: 'done',
      summary: 'Fixed mobile login bug by patching token validation.',
    });
    await svc.onCreated(ws);

    await svc.onTerminal(ws);

    const memories = await identity.listMemories();
    assert.ok(memories[0].content.includes('## Outcome'));
    assert.ok(memories[0].content.includes('done'));
    assert.ok(memories[0].content.includes('Fixed mobile login bug'));
    assert.ok(memories[0].summary?.includes('Fixed mobile login bug'));
  });

  it('records failed terminal state in memory', async () => {
    const ws = makeWorkstream({
      status: 'failed',
      summary: 'Could not reproduce in staging.',
    });
    await svc.onCreated(ws);
    await svc.onTerminal(ws);

    const memories = await identity.listMemories();
    assert.ok(memories[0].content.includes('failed'));
  });

  it('does nothing silently when no memory ref exists for updates', async () => {
    const ws = makeWorkstream();
    // Don't call onCreated — no sidecar exists
    await assert.doesNotReject(() => svc.onPlanWritten(ws, 'some plan'));
    const memories = await identity.listMemories();
    assert.equal(memories.length, 0);
  });

  it('accumulates multiple updates into one memory', async () => {
    const ws = makeWorkstream();
    await svc.onCreated(ws);
    await svc.onPlanWritten(ws, 'Plan: step 1, step 2');
    await svc.onWorkerRunFinished(ws, makeWorkerRun());
    await svc.onReviewCompleted(ws, makeReview());
    await svc.onTerminal(
      makeWorkstream({ status: 'done', summary: 'All done.' }),
    );

    const memories = await identity.listMemories();
    assert.equal(memories.length, 1);
    assert.ok(memories[0].content.includes('## Plan'));
    assert.ok(memories[0].content.includes('## Worker Run'));
    assert.ok(memories[0].content.includes('## Review'));
    assert.ok(memories[0].content.includes('## Outcome'));
  });
});
