Build a small HTTP router + middleware framework in this scaffold, across five files that must work together correctly: `src/router.js`, `src/middleware.js`, `src/request.js`, `src/response.js`, and `src/app.js` (already wired to import the other four — do not change its constructor, `use`, `get`, or `post`, only implement `handle`). Do not change any exported names or `src/index.js`.

### `src/router.js` — `Router`

1. `route(method, path, handler)` registers `handler` for an exact `method` (case-insensitive, e.g. `'get'` and `'GET'` are equivalent) + `path` pattern. A path segment starting with `:` is a named parameter (e.g. `/users/:id/posts/:postId` has params `id` and `postId`).
2. Registering the same method+path pattern again **replaces** the previous handler (last registration wins) rather than adding a second route.
3. `match(method, path)` returns `{ handler, params }` for the first registered route whose method matches and whose segment count and literal (non-`:`) segments match `path` exactly — `params` maps each `:name` segment to the string captured at that position. Returns `undefined` if no route matches (wrong method, wrong segment count, or a literal segment mismatch). No wildcard or partial matching — segment counts must match exactly.

### `src/middleware.js` — `MiddlewareChain`

1. `use(fn)` appends `fn` (signature `(ctx, next) => void | Promise<void>`) to the chain, in registration order.
2. `run(ctx, finalHandler)` executes each middleware in registration order; a middleware continues the chain by calling `await next()`. If a middleware never calls `next()`, the chain stops there — `finalHandler` and any later middlewares never run, and `run` resolves normally (this is a legitimate way for a middleware to short-circuit, not an error).
3. `finalHandler(ctx)` runs after the last middleware calls `next()` (or immediately if there are no middlewares).
4. If any middleware (or `finalHandler`) throws or returns a rejected promise, `run`'s returned promise rejects with that same error, and no further middleware or `finalHandler` runs.
5. Calling `next()` a second time within the same middleware invocation throws an error.

### `src/request.js`

1. `parseQuery(queryString)` parses a query string (no leading `?`, e.g. `"a=1&b=2"`) into a plain object. A key with a single occurrence maps to its (URI-decoded) string value. A key appearing more than once maps to an array of all its (URI-decoded) values, in order. A pair with no `=` (e.g. `"flag"`) maps to `''`. Both keys and values are decoded with `decodeURIComponent`. An empty string returns `{}`.
2. `parsePath(url)` splits `url` into `{ path, query }` at the first `?` — `query` is everything after it (`''` if there is no `?`), `path` is everything before it.

### `src/response.js`

Four small builder functions, each returning `{ status, headers, body }`:

1. `json(status, body)` — `headers: { 'content-type': 'application/json' }`, `body: JSON.stringify(body)`.
2. `text(status, body)` — `headers: { 'content-type': 'text/plain' }`, `body` used as-is (already a string).
3. `notFound()` — `json(404, { error: 'not found' })`.
4. `serverError(message)` — `json(500, { error: message })`.

### `src/app.js` — `App#handle(rawRequest)`

`rawRequest` is `{ method, url }` (e.g. `{ method: 'GET', url: '/users/42?active=true' }`). Implement `handle` to:

1. Parse `rawRequest.url` with `parsePath`/`parseQuery` from `request.js`.
2. Look up a route with `this.router.match(rawRequest.method, path)`.
3. Build a context object with (at least) `method`, `path`, `query` (the parsed object), and `params` (the matched route's params, or `{}` if nothing matched).
4. Run `this.chain.run(ctx, finalHandler)`, where `finalHandler`: if a route matched, calls the route's handler with `ctx` and stores its return value as the response; if nothing matched, stores `notFound()` as the response instead of calling any handler.
5. A middleware may set the response itself (e.g. on `ctx.response`) and decline to call `next()`, in which case the route handler must never run and that response is what `handle` ultimately returns.
6. If anything in the chain (a middleware or the matched handler) throws, `handle` must catch it and resolve with `serverError(message)` — `handle` must never reject.
7. `handle` resolves with the final response object.

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe). The grading tests exercise `App#handle` end-to-end (matched routes with params, unmatched routes, short-circuiting middleware, and errors from both middleware and handlers), so getting router.js/middleware.js/request.js right in isolation is necessary but not sufficient — they have to compose correctly through `app.js`.
