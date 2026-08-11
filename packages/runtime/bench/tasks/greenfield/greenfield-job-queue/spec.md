Build a small background-job utility library in this scaffold. Implement `src/queue.js` and `src/retry.js` per their stub signatures — do not change the exported names or `src/index.js`.

Required behavior:

### `src/queue.js` — `JobQueue`

1. `enqueue(job)` adds `job` to the back of the queue.
2. `dequeue()` removes and returns the job at the front of the queue (FIFO order — first job enqueued is the first one dequeued). It must throw if the queue is empty.
3. `peek()` returns the job at the front of the queue without removing it. It must throw if the queue is empty.
4. `size` is a getter returning the current number of jobs in the queue.
5. `isEmpty()` returns `true` if the queue has no jobs, `false` otherwise.

### `src/retry.js` — `withRetry(fn, options)`

`fn` is a function (sync or async) that may throw/reject. `withRetry` calls `fn` and, on failure, retries according to `options`:

1. `options.attempts` (default `3`) is the maximum total number of calls to `fn` (not the number of *retries* — `attempts: 1` means `fn` is called once, with no retry). It must throw synchronously if `attempts` is not an integer `>= 1`.
2. On success (no throw/rejection), `withRetry` returns `fn`'s resolved value immediately — no further calls to `fn`.
3. On failure, if attempts remain, `withRetry` calls `options.onRetry(error, attemptNumber)` if provided (`attemptNumber` is 1-based, the attempt that just failed), then waits before retrying:
   - If `options.delayFn` is provided, await `options.delayFn(attemptNumber)` instead of using a real timer.
   - Otherwise, if `options.delayMs` is set (default `0`), wait `options.delayMs * attemptNumber` milliseconds via a real timer before retrying.
4. `onRetry` must NOT be called after the final (non-retried) failure — only before a retry that is actually about to happen.
5. Once `attempts` calls have all failed, `withRetry` rejects with the error from the *last* attempt (not the first).

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe).
