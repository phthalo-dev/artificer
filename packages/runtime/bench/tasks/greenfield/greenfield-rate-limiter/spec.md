Build a small flow-control library in this scaffold. Implement `src/token-bucket.js` and `src/debounce.js` per their stub signatures — do not change the exported names, the `TokenBucket` constructor, or `src/index.js`.

Required behavior:

### `src/token-bucket.js` — `TokenBucket`

`new TokenBucket({ capacity, refillPerMs, now })` is already wired in the constructor (stores `capacity`, `refillPerMs`, `now` — a zero-arg clock function defaulting to `Date.now`, already assigned to `this.now`) and starts with `this.tokens = capacity`. The constructor must additionally throw if `capacity` is not a positive number, or if `refillPerMs` is not a non-negative number.

1. `tryRemove(n = 1)` must throw if `n` is not a positive number. Otherwise, it first refills tokens based on elapsed time since the last refill (`elapsedMs * refillPerMs` tokens added, capped at `capacity`, using `this.now()` — never call `Date.now()` directly, use `this.now()`). If the (refilled) token count is `>= n`, subtract `n` and return `true`. Otherwise leave the token count unchanged and return `false`.
2. `available` is a getter that performs the same refill-based-on-elapsed-time step as `tryRemove`, then returns the current token count (without removing any).

### `src/debounce.js` — `debounce` and `throttle`

Both accept an `options` object for dependency injection so behavior is deterministic in tests, without real timers:

- `debounce(fn, waitMs, options)`: `options.schedule` (default: real `setTimeout`) is called as `schedule(callback, waitMs)` and must return a handle; `options.cancel` (default: real `clearTimeout`) is called as `cancel(handle)`.
- `throttle(fn, waitMs, options)`: `options.now` (default: `Date.now`) is a zero-arg clock function.

1. `debounce(fn, waitMs, options)` returns a function. Each call to the returned function cancels any still-pending scheduled call (via `options.cancel`) and schedules a new one (via `options.schedule`) for `waitMs` from now, with `fn` invoked using the *arguments of that latest call* when the schedule eventually fires. Rapid repeated calls must never have more than one call scheduled at a time.
2. The function returned by `debounce` also has a `.cancel()` method: it cancels any pending scheduled call (via `options.cancel`) so `fn` will not be invoked from a call already made, and does nothing if nothing is pending.
3. `throttle(fn, waitMs, options)` returns a function that invokes `fn` (with the same arguments it was called with) immediately the first time it's called. Any further call made before `waitMs` milliseconds have elapsed (per `options.now()`) since the last time `fn` was actually invoked is dropped (not invoked, not queued). Once `waitMs` has elapsed since the last invocation, the next call invokes `fn` again immediately.

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe).
