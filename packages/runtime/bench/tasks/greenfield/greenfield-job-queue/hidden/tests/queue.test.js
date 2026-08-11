import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../src/queue.js';
import { withRetry } from '../src/retry.js';

test('enqueue/dequeue preserves FIFO order', () => {
  const q = new JobQueue();
  q.enqueue('a');
  q.enqueue('b');
  q.enqueue('c');
  assert.equal(q.dequeue(), 'a');
  assert.equal(q.dequeue(), 'b');
  assert.equal(q.dequeue(), 'c');
});

test('size and isEmpty track the queue accurately', () => {
  const q = new JobQueue();
  assert.equal(q.isEmpty(), true);
  assert.equal(q.size, 0);
  q.enqueue(1);
  q.enqueue(2);
  assert.equal(q.size, 2);
  assert.equal(q.isEmpty(), false);
  q.dequeue();
  q.dequeue();
  assert.equal(q.isEmpty(), true);
});

test('dequeue on an empty queue throws', () => {
  const q = new JobQueue();
  assert.throws(() => q.dequeue());
});

test('peek returns the front without removing it', () => {
  const q = new JobQueue();
  q.enqueue('first');
  q.enqueue('second');
  assert.equal(q.peek(), 'first');
  assert.equal(q.size, 2);
  assert.equal(q.dequeue(), 'first');
});

test('peek on an empty queue throws', () => {
  const q = new JobQueue();
  assert.throws(() => q.peek());
});

test('withRetry returns the result immediately on first success, no retries', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry retries on failure and succeeds within the attempt budget', async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return 'recovered';
    },
    { attempts: 5, delayFn: async () => {} },
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
});

test('withRetry throws the last error once attempts are exhausted', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error(`boom ${calls}`);
      },
      { attempts: 3, delayFn: async () => {} },
    ),
    /boom 3/,
  );
  assert.equal(calls, 3);
});

test('withRetry calls onRetry once per failed attempt, not after the final failure', async () => {
  const retries = [];
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error('nope');
      },
      {
        attempts: 3,
        delayFn: async () => {},
        onRetry: (err, attempt) => retries.push({ message: err.message, attempt }),
      },
    ),
  );
  assert.equal(calls, 3);
  assert.deepEqual(
    retries,
    [
      { message: 'nope', attempt: 1 },
      { message: 'nope', attempt: 2 },
    ],
  );
});

test('withRetry with attempts=1 fails immediately with no retry', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error('single shot');
      },
      { attempts: 1 },
    ),
  );
  assert.equal(calls, 1);
});
