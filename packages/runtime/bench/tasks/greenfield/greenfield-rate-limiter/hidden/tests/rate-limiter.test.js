import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../src/token-bucket.js';
import { debounce, throttle } from '../src/debounce.js';

function makeFakeScheduler() {
  let nextId = 1;
  const pending = new Map();
  return {
    schedule: (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancel: (id) => {
      pending.delete(id);
    },
    fireAll: () => {
      const cbs = [...pending.values()];
      pending.clear();
      cbs.forEach((cb) => cb());
    },
    pendingCount: () => pending.size,
  };
}

test('TokenBucket constructor validates capacity and refillPerMs', () => {
  assert.throws(() => new TokenBucket({ capacity: 0, refillPerMs: 1 }));
  assert.throws(() => new TokenBucket({ capacity: 5, refillPerMs: -1 }));
});

test('TokenBucket starts full and tryRemove succeeds up to capacity', () => {
  const bucket = new TokenBucket({ capacity: 3, refillPerMs: 0, now: () => 0 });
  assert.equal(bucket.tryRemove(1), true);
  assert.equal(bucket.tryRemove(1), true);
  assert.equal(bucket.tryRemove(1), true);
  assert.equal(bucket.tryRemove(1), false);
});

test('TokenBucket tryRemove fails without mutating state when insufficient tokens', () => {
  const bucket = new TokenBucket({ capacity: 2, refillPerMs: 0, now: () => 0 });
  assert.equal(bucket.tryRemove(5), false);
  assert.equal(bucket.available, 2);
});

test('TokenBucket refills over time according to refillPerMs, capped at capacity', () => {
  let t = 0;
  const bucket = new TokenBucket({ capacity: 5, refillPerMs: 1, now: () => t });
  bucket.tryRemove(5); // drain to 0
  t = 3;
  assert.equal(bucket.tryRemove(3), true); // 3 tokens refilled over 3ms
  t = 1000; // way more than enough to refill to capacity
  assert.equal(bucket.available, 5);
});

test('TokenBucket tryRemove requires a positive n', () => {
  const bucket = new TokenBucket({ capacity: 2, refillPerMs: 0 });
  assert.throws(() => bucket.tryRemove(0));
  assert.throws(() => bucket.tryRemove(-1));
});

test('debounce only invokes fn once, after the last call, using its arguments', () => {
  const scheduler = makeFakeScheduler();
  const calls = [];
  const debounced = debounce((...args) => calls.push(args), 100, scheduler);

  debounced('a');
  debounced('b');
  debounced('c');
  assert.equal(scheduler.pendingCount(), 1); // each call cancels the previous timer
  assert.equal(calls.length, 0);

  scheduler.fireAll();
  assert.deepEqual(calls, [['c']]);
});

test('debounce#cancel prevents the pending call from firing', () => {
  const scheduler = makeFakeScheduler();
  const calls = [];
  const debounced = debounce(() => calls.push('called'), 100, scheduler);

  debounced();
  debounced.cancel();
  assert.equal(scheduler.pendingCount(), 0);
  scheduler.fireAll();
  assert.deepEqual(calls, []);
});

test('throttle invokes fn immediately on the first call', () => {
  let t = 0;
  const calls = [];
  const throttled = throttle((x) => calls.push(x), 100, { now: () => t });
  throttled('first');
  assert.deepEqual(calls, ['first']);
});

test('throttle drops calls within the window after the last invocation', () => {
  let t = 0;
  const calls = [];
  const throttled = throttle((x) => calls.push(x), 100, { now: () => t });
  throttled('a');
  t = 50;
  throttled('b'); // within 100ms of the last call, dropped
  t = 99;
  throttled('c'); // still within window, dropped
  assert.deepEqual(calls, ['a']);
});

test('throttle allows the next call once the window has elapsed', () => {
  let t = 0;
  const calls = [];
  const throttled = throttle((x) => calls.push(x), 100, { now: () => t });
  throttled('a');
  t = 100;
  throttled('b');
  assert.deepEqual(calls, ['a', 'b']);
});
