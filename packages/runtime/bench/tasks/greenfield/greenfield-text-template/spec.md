Build a small text-formatting library in this scaffold. Implement `src/template.js` and `src/wrap.js` per their stub signatures — do not change the exported names or `src/index.js`.

Required behavior:

### `src/template.js` — `render(template, data)`

`render` substitutes `{{...}}` placeholders in `template` using values looked up in `data`, and returns the resulting string.

1. `{{name}}` looks up `data.name` and substitutes its value. `{{user.profile.name}}` looks up a nested dotted path (`data.user.profile.name`).
2. Whitespace immediately inside the braces is ignored — `{{ name }}` behaves identically to `{{name}}`.
3. If the looked-up path does not exist anywhere along the chain (missing key, or an intermediate value is `null`/`undefined`), the placeholder substitutes to an empty string — never throw, never render `undefined`/`null` literally.
4. A non-string, non-nullish value (number, boolean, etc.) is converted with `String(value)` before substitution — e.g. `{{n}}` with `data.n = 42` renders `42`.
5. A placeholder may pipe the looked-up value through one or more named filters: `{{name|upper}}` applies the `upper` filter. Filters chain left to right: `{{name|trim|upper}}` trims first, then uppercases the trimmed result. Built-in filters: `upper` (uppercase), `lower` (lowercase), `trim` (trim leading/trailing whitespace). An unrecognized filter name is a no-op (the value passes through unchanged) rather than an error.
6. A template may contain multiple placeholders and literal text; only the `{{...}}` spans are replaced, everything else in `template` is preserved verbatim.

### `src/wrap.js` — `wrapText(text, width)`

`wrapText` greedily word-wraps `text` to at most `width` characters per line and returns an array of line strings (not a single joined string).

1. Words are separated by whitespace; any run of whitespace in `text` (including newlines) is treated as a single word-separator — i.e. words are reflowed into new lines, existing line breaks in `text` are not preserved as line breaks in the output.
2. Greedily pack as many whitespace-separated words as fit into each line — appending the next word plus one separating space must not push the line's length past `width`; when it would, start a new line with that word.
3. A single word whose own length exceeds `width` is placed alone on its own line, even though that line's length then exceeds `width` (words are never split/hyphenated).
4. Empty input, or input consisting only of whitespace, returns `[]` (no lines, not `['']`).

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe).
