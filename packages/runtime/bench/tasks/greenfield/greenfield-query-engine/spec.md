Build a small in-memory, multi-table query engine in this scaffold, across four files that must work together correctly: `src/schema.js`, `src/table.js`, `src/database.js`, and `src/query.js`. Do not change any exported names or `src/index.js`.

### `src/schema.js` — `defineSchema(columns)`

`columns` is a plain object mapping column name to a `typeof`-style type string, e.g. `{ id: 'number', name: 'string' }`. Returns `{ columns, validate(row) }`, where `validate(row)`:

1. Throws if any column **other than `id`** is missing from `row`.
2. Throws if a present column's value doesn't match its declared type (`typeof row[col] !== columns[col]`).
3. Does **not** require `id` to be present — a schema's `id` column may legitimately be absent from `row` (it gets auto-assigned by `Table#insert`, see below). If `id` *is* present, it's still type-checked like any other column.

### `src/table.js` — `Table`

`new Table(schema)` starts with `this.rows = []` and `this.nextId = 1` (already wired in the scaffold).

1. `insert(row)`: if the schema has an `id` column and `row.id` is `undefined`, assign the row's `id` to the table's current `nextId` counter and increment the counter — only when auto-assigning; a row that already supplies its own `id` must not consume/advance the counter. Validate the (possibly id-assigned) row with `this.schema.validate`; if it throws, `insert` must also throw and the row must **not** be added to the table. Store a **copy** of the row (not the caller's object reference — mutating the object the caller passed in after calling `insert`, or mutating the object `insert` returned, must never change what's stored). Returns a copy of the stored row.
2. `all()` returns a **copy** of the rows array (each row itself also a copy) — mutating the returned array or its row objects must never affect the table's internal state.
3. `find(predicate)` returns the rows (copies) for which `predicate(row)` is truthy.

### `src/database.js` — `Database`

1. `createTable(name, schema)` creates and registers a new `Table` under `name`, and returns it. Throws if a table with that `name` already exists — creating a table never silently overwrites an existing one.
2. `table(name)` returns the previously-created `Table` registered under `name`; throws if no table with that name exists.

### `src/query.js`

Four standalone functions operating on plain arrays of row objects (as returned by `Table#all`/`find`) — none of them take a `Database` or `Table` directly:

1. `join(leftRows, rightRows, { on })` — `on` is `[leftKey, rightKey]`. Performs an **inner join**: for every `(left, right)` pair where `left[leftKey] === right[rightKey]`, the output contains one merged row `{ ...left, ...right }` (so a column present in both — other than the join keys themselves — takes its value from `right`). A left row that matches zero right rows produces **no** output row for it (it's dropped, not kept with nulls). A left row matching multiple right rows produces one output row per match. Preserve the order: iterate left rows in their given order, and for each, right-row matches in their given order.
2. `filter(rows, predicate)` returns `rows.filter(predicate)`.
3. `select(rows, columns)` returns new row objects containing only the keys listed in `columns` (dropping every other key), preserving row order.
4. `orderBy(rows, key, options)` returns rows sorted by `row[key]`. `options.desc` (default `false`) reverses the order. The sort is stable. When both values being compared are non-empty and numeric (e.g. `10`, `'10'`, `-4.5`), compare them as numbers; otherwise compare them as strings.

None of `join`/`filter`/`select`/`orderBy` may mutate the arrays or row objects passed in — each returns new arrays/rows.

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe). The grading tests include an end-to-end scenario that creates two tables via `Database`, inserts rows with auto-assigned ids, joins them via `query.js`, then filters/orders/selects the joined result — so getting each file right in isolation is necessary but not sufficient, they have to compose correctly.
