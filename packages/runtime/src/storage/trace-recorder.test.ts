import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Layout } from './layout.js';
import { TraceRecorder } from './trace-recorder.js';
import type { Workstream } from './types.js';

async function makeRecorder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-traces-'));
  const layout = new Layout(root);
  const recorder = new TraceRecorder(layout, 'test-agent');
  return { root, layout, recorder };
}

function workstream(overrides: Partial<Workstream> = {}): Workstream {
  return {
    id: 'ws_test',
    traceId: 'trace_test',
    title: 'Test workstream',
    goal: 'Verify durable traces',
    status: 'in_progress',
    summary: '',
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  };
}

test('creates a trace and serializes concurrent events with monotonic sequences', async () => {
  const { recorder } = await makeRecorder();
  await recorder.ensureForWorkstream(workstream());

  await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      recorder.record({
        workstreamId: 'ws_test',
        traceId: 'trace_test',
        kind: 'task',
        sourceId: `task_${index}`,
        data: { index },
      }),
    ),
  );

  const trace = await recorder.get('trace_test');
  assert.ok(trace);
  assert.equal(trace.eventCount, 32);
  assert.equal(trace.lastSequence, 32);

  const events = await recorder.listEvents('trace_test', { limit: 100 });
  assert.deepEqual(
    events.map((event) => event.sequence),
    Array.from({ length: 32 }, (_, index) => index + 1),
  );
});

test('supports bounded trace reads with offsets', async () => {
  const { recorder } = await makeRecorder();
  await recorder.ensureForWorkstream(workstream());
  for (let index = 0; index < 10; index += 1) {
    await recorder.record({
      workstreamId: 'ws_test',
      traceId: 'trace_test',
      kind: 'finding',
      data: { index },
    });
  }

  const events = await recorder.listEvents('trace_test', {
    offset: 4,
    limit: 3,
  });
  assert.deepEqual(
    events.map((event) => event.sequence),
    [5, 6, 7],
  );
});

test('redacts sensitive keys and token-like strings from event data', async () => {
  const { recorder } = await makeRecorder();
  const event = await recorder.record({
    workstreamId: 'ws_test',
    traceId: 'trace_test',
    kind: 'message',
    data: {
      apiKey: 'secret-api-key',
      nested: { token: 'nested-secret' },
      text: 'Bearer abc123 and ghp_exampletoken',
      safe: 'visible',
    },
  });

  assert.ok(event);
  assert.equal(event.data.apiKey, '[REDACTED]');
  assert.deepEqual(event.data.nested, { token: '[REDACTED]' });
  assert.equal(event.data.text, 'Bearer [REDACTED] and [REDACTED]');
  assert.equal(event.data.safe, 'visible');
});

test('ignores a malformed final JSONL line but rejects a malformed middle line', async () => {
  const { layout, recorder } = await makeRecorder();
  await recorder.ensureForWorkstream(workstream());
  await recorder.record({
    workstreamId: 'ws_test',
    traceId: 'trace_test',
    kind: 'workstream',
    data: { event: 'valid' },
  });

  await fs.appendFile(
    layout.traceEventsFile('trace_test'),
    '{not-json\n',
    'utf8',
  );
  const recovered = await recorder.listEvents('trace_test', { limit: 10 });
  assert.equal(recovered.length, 1);

  await recorder.record({
    workstreamId: 'ws_test',
    traceId: 'trace_test',
    kind: 'workstream',
    data: { event: 'after-corruption' },
  });
  await assert.rejects(
    recorder.listEvents('trace_test', { limit: 10 }),
    /Malformed trace event line/,
  );
});

test('backfills an existing workstream with a deterministic initial event', async () => {
  const { recorder } = await makeRecorder();
  const existing = workstream({ traceId: undefined });

  await recorder.backfill([existing]);
  const trace = await recorder.get('trace_ws_test');
  assert.ok(trace);
  assert.equal(trace.workstreamId, existing.id);
  assert.equal(trace.backfilled, true);
  assert.equal(trace.eventCount, 1);

  const events = await recorder.listEvents('trace_ws_test');
  assert.equal(events[0]?.data.backfilled, true);
  await recorder.backfill([existing]);
  assert.equal((await recorder.get('trace_ws_test'))?.eventCount, 1);
});

test('record repairs stale metadata before assigning the next sequence', async () => {
  const { layout, recorder } = await makeRecorder();
  await recorder.ensureForWorkstream(workstream());
  await recorder.record({
    workstreamId: 'ws_test',
    traceId: 'trace_test',
    kind: 'workstream',
    data: { event: 'one' },
  });

  const traceFile = layout.traceFile('trace_test');
  const trace = JSON.parse(await fs.readFile(traceFile, 'utf8')) as {
    eventCount: number;
    lastSequence: number;
  };
  trace.eventCount = 0;
  trace.lastSequence = 0;
  await fs.writeFile(traceFile, JSON.stringify(trace), 'utf8');

  const next = await recorder.record({
    workstreamId: 'ws_test',
    traceId: 'trace_test',
    kind: 'workstream',
    data: { event: 'two' },
  });
  assert.equal(next?.sequence, 2);

  const events = await recorder.listEvents('trace_test', { limit: 10 });
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2],
  );
});

test('reconcile repairs trace counters after an interrupted metadata write', async () => {
  const { layout, recorder } = await makeRecorder();
  await recorder.ensureForWorkstream(workstream());
  await recorder.record({
    workstreamId: 'ws_test',
    traceId: 'trace_test',
    kind: 'workstream',
    data: { event: 'one' },
  });

  const traceFile = layout.traceFile('trace_test');
  const trace = JSON.parse(await fs.readFile(traceFile, 'utf8')) as {
    eventCount: number;
    lastSequence: number;
  };
  trace.eventCount = 0;
  trace.lastSequence = 0;
  await fs.writeFile(traceFile, JSON.stringify(trace), 'utf8');

  const repaired = await recorder.reconcile('trace_test');
  assert.equal(repaired?.eventCount, 1);
  assert.equal(repaired?.lastSequence, 1);
});

test('calls TraceSink.ensureTrace when creating a new trace record', async () => {
  const { layout } = await makeRecorder();
  let ensured = false;
  const sinkRecorder = new TraceRecorder(layout, 'test-agent', {
    ensureTrace: async () => {
      ensured = true;
      return { externalId: 'ext_1' };
    },
    appendEvents: async () => {},
  });
  await sinkRecorder.ensureForWorkstream(workstream());
  assert.equal(ensured, true);
});
