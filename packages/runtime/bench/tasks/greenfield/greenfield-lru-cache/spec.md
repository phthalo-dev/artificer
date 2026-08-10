Build a small caching library in this scaffold. Implement `src/lru-cache.js` and `src/ttl-cache.js` per their stub signatures — do not change the exported names, the constructors, or `src/index.js`. These are two independent cache implementations with different eviction strategies; do not make one depend on the other.

Required behavior:

### `src/lru-cache.js` — `LRUCache`

`new LRUCache(capacity)` must throw if `capacity` is not an integer `>= 1`.

1. `set(key, value)` stores `value` under `key`. If `key` already exists, its value is updated. Every `set` marks `key` as the most-recently-used entry.
2. `get(key)` returns the stored value, or `undefined` if `key` is not present. A successful `get` (key found) also marks `key` as the most-recently-used entry.
3. `has(key)` returns whether `key` is present, **without** affecting recency — calling `has` must never protect a key from later eviction the way `get`/`set` do.
4. `delete(key)` removes `key` if present and returns `true`; returns `false` if `key` was not present.
5. `size` is a getter returning the current number of entries.
6. When a `set` for a *new* key would push the cache beyond `capacity`, evict the least-recently-used entry first (the entry that was least recently `get` or `set`, or never accessed since insertion). Updating an *existing* key's value via `set` never triggers eviction and never grows `size`.

### `src/ttl-cache.js` — `TTLCache`

`new TTLCache(options)` accepts `options.now` — a zero-arg function returning the current time in milliseconds, defaulting to `Date.now`. Store and use this function (already wired in the constructor) instead of calling `Date.now()` directly, so time is fully controllable in tests.

1. `set(key, value, ttlMs)` stores `value` under `key`, expiring `ttlMs` milliseconds from now (as reported by `this.now()`). It must throw if `ttlMs` is not a positive number.
2. `get(key)` returns the stored value if `key` exists and has not yet expired (current time `< ` its expiry); returns `undefined` if `key` is missing or expired.
3. `has(key)` returns the same presence/expiry judgment as `get`, as a boolean, without exposing the value.
4. `delete(key)` removes `key` regardless of expiry state and returns whether something was removed.
5. `size` is a getter returning the count of entries that are **not** currently expired (an expired-but-not-yet-accessed entry must not count toward `size`).

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe).
