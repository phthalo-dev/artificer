import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decidePoll } from './poll.js';
import type { RuntimeState } from './client.js';

const GRACE = 15_000;

function state(
  partial: Partial<RuntimeState> & { busy: boolean },
): RuntimeState {
  return {
    agentName: 'test',
    busy: partial.busy,
    queue: partial.queue ?? { pending: 0, running: 0 },
    workstreams: partial.workstreams ?? [],
  };
}

function ws(status: string) {
  return { id: 'ws_1', title: 't', status: status as never };
}

test('done workstream -> terminal/submitted', () => {
  const d = decidePoll(state({ busy: false, workstreams: [ws('done')] }), undefined, 1000, GRACE);
  assert.deepEqual(d, { kind: 'terminal', outcome: 'submitted', workstreamStatus: 'done' });
});

test('blocked workstream -> terminal/blocked', () => {
  const d = decidePoll(state({ busy: false, workstreams: [ws('blocked')] }), undefined, 1000, GRACE);
  assert.equal(d.kind, 'terminal');
  assert.equal((d as { outcome: string }).outcome, 'blocked');
});

test('failed/cancelled workstream -> terminal/failed', () => {
  for (const s of ['failed', 'cancelled']) {
    const d = decidePoll(state({ busy: false, workstreams: [ws(s)] }), undefined, 1000, GRACE);
    assert.equal((d as { outcome: string }).outcome, 'failed');
  }
});

test('non-terminal workstream while busy -> wait, idle reset', () => {
  const d = decidePoll(
    state({ busy: true, workstreams: [ws('in_progress')] }),
    5_000,
    9_999,
    GRACE,
  );
  assert.deepEqual(d, { kind: 'wait', idleSince: undefined });
});

test('non-terminal workstream that just went idle -> wait, idle clock starts', () => {
  const d = decidePoll(
    state({ busy: false, workstreams: [ws('in_progress')] }),
    undefined,
    1000,
    GRACE,
  );
  assert.deepEqual(d, { kind: 'wait', idleSince: 1000 });
});

test('non-terminal workstream idle past grace -> stalled', () => {
  const d = decidePoll(
    state({ busy: false, workstreams: [ws('in_progress')] }),
    1000,
    1000 + GRACE + 1,
    GRACE,
  );
  assert.deepEqual(d, { kind: 'stalled' });
});

test('no workstream yet and idle past grace -> stalled', () => {
  const d = decidePoll(state({ busy: false }), 1000, 1000 + GRACE + 1, GRACE);
  assert.deepEqual(d, { kind: 'stalled' });
});

test('no workstream but busy -> wait, idle reset', () => {
  const d = decidePoll(state({ busy: true }), 5000, 9000, GRACE);
  assert.deepEqual(d, { kind: 'wait', idleSince: undefined });
});
