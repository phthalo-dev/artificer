Build a small task-tracker CLI with JSON persistence in this scaffold, across six files that must work together correctly: `src/store.js`, `src/persistence.js`, `src/commands/add.js`, `src/commands/list.js`, `src/commands/complete.js`, and `src/cli.js` (already wired to import the three command modules — do not change its imports, only implement `runCli`). Do not change any exported names or `src/index.js`.

### `src/store.js` — `TaskStore`

A task is `{ id, title, priority, done, tags }`.

1. `add({ title, priority, tags })`: `title` is trimmed; throws if the trimmed title is empty. `priority` defaults to `'medium'` when omitted; throws if given a value other than `'low'`, `'medium'`, or `'high'`. `tags` defaults to `[]` when omitted. Assigns a sequential numeric `id` starting at 1 (track it on the store, e.g. `this.nextId`, incrementing after each add). New tasks start with `done: false`. Returns the created task.
2. `get(id)` returns the task with that `id`; throws if none exists.
3. `complete(id)` sets that task's `done` to `true` and returns it; throws (via `get`) if the id doesn't exist.
4. `remove(id)` removes that task; throws if the id doesn't exist.
5. `list({ priority, tag, done })` returns tasks matching **all** of the filters that were actually provided (each omitted filter doesn't constrain the results) — `priority` is an exact match, `tag` matches if the task's `tags` array includes it, `done` is an exact boolean match. Calling `list()` with no filters returns every task, in original insertion order.

### `src/persistence.js`

1. `saveStore(filePath, store)` serializes `{ tasks: store.tasks, nextId: store.nextId }` to JSON and writes it to `filePath` **atomically**: write to a temp path (e.g. `` `${filePath}.tmp` ``) first, then rename it onto `filePath` — never write `filePath` directly, so a process that dies mid-write can't leave a corrupted file. No `.tmp` file should remain after `saveStore` resolves.
2. `loadStore(filePath)` reads and parses that JSON and returns a **new, fully usable `TaskStore`** (not a plain data object) with its `tasks` and `nextId` restored — calling `.add(...)` on the loaded store must correctly continue the id sequence from where it left off.

### `src/commands/add.js` — `runAdd(store, args)`

`args` is an array of CLI argument strings, e.g. `['Buy', 'milk', '--priority', 'high', '--tags', 'errand,urgent']`.

1. The title is every argument before the first one starting with `--`, joined with single spaces (`'Buy milk'` above).
2. If there are no such leading arguments (title would be empty), return `{ ok: false, error: <message> }` **without** calling `store.add` — do not throw.
3. Otherwise parse `--priority <value>` and `--tags <comma,separated,list>` from the remaining arguments (`--tags` becomes an array split on commas; if `--priority`/`--tags` are absent, pass `undefined` through so `store.add`'s own defaulting applies) and call `store.add`. If `store.add` throws (e.g. an invalid priority), catch it and return `{ ok: false, error: err.message }`. On success return `{ ok: true, task }`.

### `src/commands/list.js` — `runList(store, args)`

Parses optional `--priority <value>`, `--tag <value>`, and `--done <true|false>` flags from `args` (same `--flag value` style as above). If `--done` is present but its value is neither the literal string `'true'` nor `'false'`, return `{ ok: false, error: <message> }`. Otherwise call `store.list(...)` with the parsed filters (converting `--done`'s string to a real boolean; omitted flags stay `undefined`) and return `{ ok: true, tasks }`.

### `src/commands/complete.js` — `runComplete(store, args)`

`args[0]` should be the task id. If it's missing or not composed entirely of digits (i.e. not a valid non-negative integer), return `{ ok: false, error: <message> }` **without** calling `store.complete`. Otherwise call `store.complete(Number(args[0]))`; if it throws (unknown id), catch it and return `{ ok: false, error: err.message }`. On success return `{ ok: true, task }`.

### `src/cli.js` — `runCli(store, argv)`

`argv[0]` is the subcommand name, `argv.slice(1)` are that command's own args. Dispatch `'add'` → `runAdd`, `'list'` → `runList`, `'complete'` → `runComplete`, each with `(store, argv.slice(1))`, and return that command's result directly. If `argv` is empty or the command name doesn't match any of the three, return `{ ok: false, error: <message> }` instead — `runCli` must never throw.

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe). The grading tests exercise the whole pipeline through `runCli` (add → list → complete, with various filters and malformed input), so getting store.js/persistence.js right in isolation is necessary but not sufficient — every command module has to compose correctly with the store and with `cli.js`'s dispatch.
