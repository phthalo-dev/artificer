Build a tiny stack-based virtual machine in this scaffold, across four files that must work together correctly: `src/tokenizer.js`, `src/parser.js`, `src/vm.js` (its constructor is already wired — do not change it, only implement `run`), and `src/index.js` (implement `compileAndRun`; its imports and re-exports are already correct). Do not change any exported names.

The VM executes programs written in a tiny line-based assembly language. Each line is exactly one of:

- An **instruction**: an opcode, optionally followed by a single space-separated argument (e.g. `PUSH 5`, `STORE x`, `ADD`).
- A **label definition**: an identifier immediately followed by `:`, with nothing else on the line (e.g. `loop:`).
- A **comment or blank line**: a line that, after trimming leading/trailing whitespace, is empty or starts with `#`. These produce no tokens at all.

### `src/tokenizer.js` — `tokenize(source)`

Splits `source` into an array of token objects, one per non-blank/non-comment line, in order:

- A label line becomes `{ type: 'label', name }`.
- An instruction line becomes `{ type: 'instruction', op, arg, line }` — `op` is the first whitespace-separated word, `arg` is the second word if present or `undefined` if the line has only an opcode, and `line` is the 1-based source line number (used for error messages). A line with **more than one** argument token is malformed — throw.

### `src/parser.js` — `parse(tokens)`

Converts tokens into `{ instructions, labels }`:

- `instructions` is an array of `{ op, arg }`, one per instruction token (label tokens don't produce an instruction).
- `labels` is a `Map` from each label name to the index (into `instructions`) of the instruction immediately following it. Throw on a **duplicate** label definition.
- Argument handling by opcode: `PUSH`'s argument is required and converted with `Number(arg)` — throw if it's not a valid number. `STORE`, `LOAD`, `JMP`, `JZ` each require a (string) argument — throw if missing. `POP`, `ADD`, `SUB`, `MUL`, `DIV`, `DUP`, `PRINT`, `HALT` take **no** argument — throw if one is present. Any opcode outside this list is unknown — throw.
- After building `instructions`, validate that every `JMP`/`JZ` instruction's argument names a label that actually exists somewhere in `labels` — throw if not (this is a parse-time check, not deferred to execution).

### `src/vm.js` — `VM#run(program)`

`program` is `{ instructions, labels }` from `parse`. The VM already has `this.stack = []`, `this.vars = new Map()`, `this.output = []`, `this.pc = 0` from its constructor — `run` should reset `this.pc = 0` and then execute starting there. Opcode semantics (the two arithmetic operands are popped as `b` then `a`, i.e. `a` was pushed first — `SUB`/`DIV` are **not** commutative, `a OP b`):

- `PUSH n` pushes `n`.
- `POP` pops and discards the top value.
- `ADD`/`SUB`/`MUL` pop `b` then `a`, push `a+b`/`a-b`/`a*b`.
- `DIV` pops `b` then `a`; throws (a distinct error from stack underflow) if `b === 0`; otherwise pushes `a/b` **truncated toward zero** (e.g. `-7 / 2` → `-3`, not `-4`).
- `DUP` pushes a copy of the current top value without removing it.
- `STORE name` pops the top value and stores it under `name`.
- `LOAD name` pushes the value previously stored under `name`; throws if `name` was never stored.
- `PRINT` pops the top value and appends it to `this.output`.
- `JMP label` unconditionally sets `pc` to `labels.get(label)`.
- `JZ label` pops the top value; if it equals `0`, sets `pc` to `labels.get(label)`; otherwise continues to the next instruction. Either way, the value is consumed.
- `HALT` stops execution immediately — `run` returns `this.output` right away, without running whatever instructions (if any) come after it.
- Every opcode that reads from the stack (`POP`, `ADD`/`SUB`/`MUL`/`DIV`, `DUP`, `STORE`, `PRINT`, `JZ`) must throw a stack-underflow error if there aren't enough values on the stack — never read past the end of the stack.
- A program that reaches the end of `instructions` without hitting `HALT` terminates normally (not an error) — `run` returns `this.output`.

### `src/index.js` — `compileAndRun(source)`

Runs the full pipeline: `tokenize` → `parse` → `new VM().run(...)`, returning the resulting output array. Any error from any stage (malformed tokens, parse-time validation, or a runtime error during execution) must propagate out of `compileAndRun` uncaught — it should not swallow or convert errors.

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe). The grading tests include multi-instruction programs with loops (`JMP`/`JZ` used together to implement a countdown), so getting each file individually correct is necessary but not sufficient — label resolution, jump semantics, and stack discipline all have to compose correctly across the whole pipeline for a real program to execute to the right output.
