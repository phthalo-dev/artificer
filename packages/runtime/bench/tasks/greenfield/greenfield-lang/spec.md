Build a tree-walking interpreter for a small dynamically-typed language in this scaffold. This is a full pipeline across many files — do not change any exported names, any class's constructor, `src/parser/state.js`, `src/callable.js`, `src/interpreter.js`, or the imports already present at the top of any stub file.

**Already fully implemented, do not touch:**
- `src/parser/state.js` — a token-cursor helper (`makeState`, `peek`, `advance`, `check`, `expect`) that `parser/expressions.js` and `parser/statements.js` should use.
- `src/callable.js` — `ReturnSignal` (wraps a return value, thrown to unwind a function call), `UserFunction` (wraps a `FunctionDecl` AST node + its closure `Environment`, with an `arity` getter), `BuiltinFunction` (wraps a native JS implementation).
- `src/interpreter.js` — the `Interpreter` class; it already wires `evaluate`/`execute`/`run` to call into the functions you implement in `eval/expressions.js` and `eval/statements.js`.

**Values:** every runtime value is one of: a JS `number`, a JS `string`, a JS `boolean`, or `null` (representing the language's `nil`). There is no other value type (no arrays, no objects).

### The language

Source is a sequence of statements. `//` starts a line comment; blank lines and comments produce no tokens. Every token has a `type` field, and `tokenize`'s output is checked against these **exact** `type` strings — not the raw source text, and not any other naming scheme:

| Source | `type` | Source | `type` | Source | `type` |
| --- | --- | --- | --- | --- | --- |
| (int/float literal) | `NUMBER` | `while` | `WHILE` | `,` | `COMMA` |
| (double-quoted string) | `STRING` | `return` | `RETURN` | `+` | `PLUS` |
| (identifier) | `IDENT` | `true` | `TRUE` | `-` | `MINUS` |
| `let` | `LET` | `false` | `FALSE` | `*` | `STAR` |
| `function` | `FUNCTION` | `nil` | `NIL` | `/` | `SLASH` |
| `if` | `IF` | `(` | `LPAREN` | `=` | `EQ` |
| `else` | `ELSE` | `)` | `RPAREN` | `==` | `EQEQ` |
| | | `{` | `LBRACE` | `!=` | `BANGEQ` |
| | | `}` | `RBRACE` | `<` | `LT` |
| | | `;` | `SEMICOLON` | `<=` | `LTEQ` |
| | | | | `>` | `GT` |
| | | | | `>=` | `GTEQ` |
| | | | | `&&` | `AND` |
| | | | | `\|\|` | `OR` |
| | | | | `!` | `BANG` |

A keyword (`let`, `function`, `if`, `else`, `while`, `return`, `true`, `false`, `nil`) is its own token type per the table above — never `IDENT`. The end of input produces one final `{type: 'EOF'}` token.

Grammar (statements):
- `let IDENT = expression ;` — declares a new variable in the current scope.
- `function IDENT ( params? ) block` — declares a named function in the current scope; `params` is a comma-separated `IDENT` list.
- `if ( expression ) block (else block)?`
- `while ( expression ) block`
- `return expression? ;` — bare `return;` returns `nil`.
- `{ statement* }` — a block.
- any other line is `expression ;` (an expression statement).

Grammar (expressions, lowest to highest precedence): assignment (`IDENT = expression`, right-associative, only a plain variable name is a valid target) → `||` → `&&` → equality (`== !=`) → comparison (`< <= > >=`) → additive (`+ -`) → multiplicative (`* /`) → unary (`! -`, prefix) → call (`primary(args?)`, chainable, e.g. `f()()`) → primary (number/string/`true`/`false`/`nil`/identifier/`( expression )`).

### AST shapes produced by the parser

Statements: `{type:'LetDecl', name, value}`, `{type:'FunctionDecl', name, params, body}` (`params` is a string array, `body` is a `Block`), `{type:'If', condition, thenBranch, elseBranch}` (`elseBranch` is `null` if absent; both branches are `Block` nodes), `{type:'While', condition, body}` (`body` is a `Block`), `{type:'Return', value}` (`value` is `null` for a bare `return;`), `{type:'Block', statements}`, `{type:'ExpressionStmt', expr}`.

Expressions: `{type:'Literal', value}`, `{type:'Variable', name}`, `{type:'Assign', name, value}`, `{type:'Logical', op, left, right}` (`op` is `'&&'`/`'||'`), `{type:'Unary', op, operand}` (`op` is `'!'`/`'-'`), `{type:'Binary', op, left, right}` (`op` one of `+ - * / < <= > >= == !=`), `{type:'Call', callee, args}`.

### `src/lexer.js` — `tokenize(source)`

Returns an array of `{type, value, line}` tokens per the grammar above, ending with an `EOF` token. `value` is present for `NUMBER`/`STRING`/`IDENT` tokens (undefined for everything else). Throws on an unterminated string or an unrecognized character.

### `src/parser/expressions.js` — `parseExpression(state)`

Parses one expression starting at `state`'s current position (advancing it), per the precedence table above, producing the AST shapes above. Assignment throws if the left-hand side isn't a plain `Variable`.

### `src/parser/statements.js` — `parseStatement(state)`

Parses one statement (dispatching on the next token: `let`/`function`/`if`/`while`/`return`/`{` vs. falling through to an expression statement), producing the AST shapes above. Calls `parseExpression` from `./expressions.js` for any sub-expressions.

### `src/parser/index.js` — `parse(tokens)`

Repeatedly calls `parseStatement` until the token stream is exhausted (`EOF`), returning the array of top-level statement nodes.

### `src/environment.js` — `Environment`

Constructor already sets `this.parent` and `this.values = new Map()`.

1. `define(name, value)` adds `name` to **this** environment's own values. Throws if `name` already exists in this same environment (redeclaring in the same scope is an error) — but shadowing a name from an **outer** scope by declaring it fresh in an **inner** scope is fine and expected.
2. `get(name)` returns the value bound to `name`, searching this environment then walking up through `parent`. Throws if `name` is found nowhere in the chain.
3. `set(name, value)` updates an **existing** binding's value — search this environment then `parent` for whichever one already owns `name`, and update it there (not necessarily in the current environment). Throws if `name` is found nowhere in the chain (assignment to an undeclared variable is an error, unlike `let`).

### `src/values.js`

1. `isTruthy(value)` — **only** `false` and `nil` (`null`) are falsy; every other value (including `0` and `""`) is truthy. This is a deliberate design choice, not a bug — do not use JS's own truthiness rules.
2. `stringify(value)` — the display form used by `print`: `nil` → `'nil'`, booleans → `'true'`/`'false'`, numbers/strings → `String(value)`.

### `src/builtins.js` — `installBuiltins(globalEnv, interpreter)`

Defines two `BuiltinFunction`s in `globalEnv` (via `Environment#define`): `print` (arity 1) appends `stringify(args[0])` to `interpreter.output` and returns `nil`; `len` (arity 1) returns a string argument's `.length`, throwing if the argument isn't a string.

### `src/eval/expressions.js` — `evaluateExpression(node, env, interpreter)`

Evaluates an expression AST node in environment `env`, dispatching on `node.type`, and returns its value:

1. `Literal` → `node.value`. `Variable` → `env.get(node.name)`. `Assign` → evaluate `node.value`, `env.set(node.name, ...)`, and return that value.
2. `Logical`: `&&` evaluates `left`; if `isTruthy(left)` is false, returns `left` **without evaluating `right`**; otherwise evaluates and returns `right`. `||` is the mirror: if `left` is truthy, returns `left` without evaluating `right`; otherwise evaluates and returns `right`. (Both operators return the operand's actual value, not necessarily a boolean.)
3. `Unary`: `!` returns the real boolean `!isTruthy(operand)`. `-` requires a number operand (throw otherwise) and returns its negation.
4. `Binary`: `+` requires both operands to be numbers (numeric add) **or** both strings (concatenation); throws for any other combination. `- * /` require both operands to be numbers; throw otherwise. `< <= > >=` require both operands to be numbers, **or** both strings (compared with JS's native `<`/`<=`/etc., which is correct for strings too); throw for a type mismatch or any other type. `== !=` never throw — they compare with strict equality/inequality across **any** value types (differently-typed operands are simply unequal, not an error).
5. `Call`: evaluate `callee` and each of `node.args`. If `callee` is a `BuiltinFunction`, check its `arity` against the evaluated arg count (throw on mismatch) and invoke `callee.fn(args, interpreter)`. If `callee` is a `UserFunction`, check arity the same way, create `new Environment(callee.closure)` — the function's **closure**, not the caller's environment — bind each param name to its argument in that new environment, then `interpreter.execute(callee.declaration.body, ...)` that new environment; catch a thrown `ReturnSignal` and return its `.value`; if the body completes without one, return `nil`. Calling anything else (a number, string, etc.) throws.

### `src/eval/statements.js` — `executeStatement(node, env, interpreter)`

Executes a statement AST node in environment `env` (calling `evaluateExpression` from `./expressions.js` for sub-expressions), dispatching on `node.type`:

1. `LetDecl`: evaluate `value`, `env.define(name, ...)`. `FunctionDecl`: `env.define(name, new UserFunction(node, env))` — the closure is **the environment the function was declared in**, captured at declaration time.
2. `ExpressionStmt`: evaluate `expr` and discard the result.
3. `Block`: create `new Environment(env)` (a **fresh child scope**, every time a block runs — including every iteration of a loop) and execute each of `node.statements` in it, in order.
4. `If`: evaluate `condition`; if truthy, execute `thenBranch`; else if `elseBranch` is present, execute it.
5. `While`: while `condition` evaluates truthy, execute `body` (each iteration gets a fresh scope via `Block`'s own handling — do not create the scope yourself here).
6. `Return`: evaluate `value` if present (else `nil`) and `throw new ReturnSignal(thatValue)` — this is how a call unwinds early; do not catch it here.

### `src/index.js` — `run(source)`

The full pipeline: `tokenize(source)` → `parse(tokens)` → `new Interpreter()` → `interpreter.run(program)`, returning the interpreter's output array (each `print` call's `stringify`d value, in order).

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe). The grading tests include closures (independent state across multiple calls to a function-returning factory), recursion, lexical (not dynamic) scoping, and short-circuit evaluation — every layer has to compose correctly for these to produce the right output, not just each file's isolated behavior.
