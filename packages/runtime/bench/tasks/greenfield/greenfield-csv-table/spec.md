Build a small CSV parsing and tabular-query library in this scaffold. Implement `src/csv.js` and `src/table.js` per their stub signatures — do not change the exported names or `src/index.js`.

Required behavior:

### `src/csv.js` — `parseCsv(text)`

Parses `text` as CSV and returns an array of plain row objects, keyed by the header row's column names. All values are strings (no type coercion).

1. The first line is the header row (comma-separated column names). Every subsequent line is a data row with the same number of fields as the header.
2. A field may be wrapped in double quotes (`"..."`). Inside a quoted field, commas and newlines are literal characters, not delimiters — e.g. `"Doe, John"` is a single field containing a comma.
3. A literal double quote inside a quoted field is written as two consecutive double quotes (`""`), which unescapes to one `"` in the parsed value — e.g. `"She said ""hi"""` parses to `She said "hi"`.
4. Input consisting only of whitespace, or the empty string, parses to `[]`.
5. A header row with no data rows after it (with or without a trailing newline) parses to `[]`.
6. A trailing newline at the very end of the input must NOT produce a phantom empty row; parsing must also work correctly when the input has no trailing newline at all.

### `src/table.js` — `Table`

`new Table(rows)` wraps an array of plain row objects (e.g. `parseCsv`'s output). Every method below returns a **new** `Table` (or, for `groupBy`, a `Map`) — the original `Table`'s `rows` array must never be mutated, so results can be chained.

1. `filter(predicate)` returns a new `Table` containing only the rows for which `predicate(row)` is truthy.
2. `sortBy(key, options)` returns a new `Table` with rows sorted by `row[key]`. `options.desc` (default `false`) reverses the order. The sort is stable (equal-key rows keep their original relative order, even when `desc` is true). When both values being compared are non-empty and numeric (e.g. `"30"`, `"-4.5"`), compare them as numbers; otherwise compare them as strings.
3. `groupBy(key)` returns a `Map` from each distinct `row[key]` value to an array of the full row objects sharing that value. Keys appear in the Map in the order their value was first seen among the rows.
4. `select(columns)` returns a new `Table` whose rows are projected to contain only the keys listed in the `columns` array (dropping every other key), preserving row order.

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe).
