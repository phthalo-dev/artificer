import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser/index.js';
import { Interpreter } from '../src/interpreter.js';
import { Environment } from '../src/environment.js';
import { run } from '../src/index.js';

// --- lexer.js ---

test('tokenize handles integers, floats, strings with escapes, and comments', () => {
  const toks = tokenize('42 3.5 "a\\"b" // comment\nlet');
  const types = toks.map((t) => t.type);
  assert.deepEqual(types, ['NUMBER', 'NUMBER', 'STRING', 'LET', 'EOF']);
  assert.equal(toks[0].value, 42);
  assert.equal(toks[1].value, 3.5);
  assert.equal(toks[2].value, 'a"b');
});

test('tokenize distinguishes keywords from plain identifiers', () => {
  const toks = tokenize('true false nil letx');
  assert.deepEqual(
    toks.map((t) => t.type),
    ['TRUE', 'FALSE', 'NIL', 'IDENT', 'EOF'],
  );
  assert.equal(toks[3].value, 'letx');
});

test('tokenize recognizes two-character operators distinctly from their prefixes', () => {
  const toks = tokenize('== != <= >= && ||');
  assert.deepEqual(
    toks.map((t) => t.type),
    ['EQEQ', 'BANGEQ', 'LTEQ', 'GTEQ', 'AND', 'OR', 'EOF'],
  );
});

// --- environment.js ---

test('Environment get/set walk the scope chain to find the owning scope', () => {
  const outer = new Environment(null);
  outer.define('x', 1);
  const inner = new Environment(outer);
  assert.equal(inner.get('x'), 1);
  inner.set('x', 2);
  assert.equal(outer.get('x'), 2); // set() found and updated the OWNING (outer) scope
});

test('Environment#define throws on redeclaring a name already in the same scope', () => {
  const env = new Environment(null);
  env.define('x', 1);
  assert.throws(() => env.define('x', 2));
});

test('Environment#get and #set throw for a name that exists nowhere in the chain', () => {
  const env = new Environment(new Environment(null));
  assert.throws(() => env.get('missing'));
  assert.throws(() => env.set('missing', 1));
});

// --- parser.js: precedence and associativity ---

test('parser gives * higher precedence than +', () => {
  const [stmt] = parse(tokenize('1 + 2 * 3;'));
  assert.equal(stmt.expr.op, '+');
  assert.equal(stmt.expr.right.op, '*');
});

test('parser gives comparison lower precedence than arithmetic', () => {
  const [stmt] = parse(tokenize('1 + 2 < 3 * 4;'));
  assert.equal(stmt.expr.op, '<');
});

test('assignment is right-associative and only valid against a plain variable target', () => {
  assert.throws(() => parse(tokenize('1 + 2 = 3;')));
});

// --- interpreter.js: values, truthiness, operators ---

test('only false and nil are falsy — 0 and the empty string are truthy', () => {
  assert.deepEqual(run('if (0) { print("zero-truthy"); }'), ['zero-truthy']);
  assert.deepEqual(run('if ("") { print("empty-string-truthy"); }'), ['empty-string-truthy']);
  assert.deepEqual(run('if (nil) { print("unreachable"); } else { print("nil-falsy"); }'), [
    'nil-falsy',
  ]);
});

test('+ adds numbers or concatenates strings, but rejects mixed types', () => {
  assert.deepEqual(run('print(1 + 2);'), ['3']);
  assert.deepEqual(run('print("a" + "b");'), ['ab']);
  assert.throws(() => run('print(1 + "a");'));
});

test('- * / require numeric operands and throw otherwise', () => {
  assert.deepEqual(run('print(5 - 2);'), ['3']);
  assert.deepEqual(run('print(3 * 4);'), ['12']);
  assert.deepEqual(run('print(7 / 2);'), ['3.5']);
  assert.throws(() => run('print("a" - 1);'));
});

test('comparisons work for same-typed operands and throw for mismatched types', () => {
  assert.deepEqual(run('print(2 < 3);'), ['true']);
  assert.deepEqual(run('print("a" < "b");'), ['true']);
  assert.throws(() => run('print(1 < "a");'));
});

test('== and != compare across any types without throwing, false when types differ', () => {
  assert.deepEqual(run('print(1 == "1");'), ['false']);
  assert.deepEqual(run('print(1 != "1");'), ['true']);
  assert.deepEqual(run('print(nil == nil);'), ['true']);
});

test('&& and || short-circuit: the right side is never evaluated when unnecessary', () => {
  const src = `
    function boom() { print("called"); return true; }
    if (false && boom()) { }
    if (true || boom()) { }
    print("done");
  `;
  assert.deepEqual(run(src), ['done']);
});

test('&& and || return the operand value, not necessarily a boolean', () => {
  assert.deepEqual(run('print(nil && "unreached");'), ['nil']);
  assert.deepEqual(run('print(nil || "fallback");'), ['fallback']);
  assert.deepEqual(run('print(0 && "reached-since-0-is-truthy");'), [
    'reached-since-0-is-truthy',
  ]);
});

test('unary ! always yields a real boolean; unary - requires a number', () => {
  assert.deepEqual(run('print(!0);'), ['false']);
  assert.deepEqual(run('print(!nil);'), ['true']);
  assert.deepEqual(run('print(-5);'), ['-5']);
  assert.throws(() => run('print(-"a");'));
});

// --- interpreter.js: scoping ---

test('a block introduces a fresh scope; a shadowed variable does not leak out', () => {
  const src = `
    let x = 1;
    if (true) {
      let x = 2;
      print(x);
    }
    print(x);
  `;
  assert.deepEqual(run(src), ['2', '1']);
});

test('a while loop body gets a fresh scope each iteration (no redeclare error, no leakage across iterations)', () => {
  const src = `
    let i = 0;
    while (i < 3) {
      let y = i * 10;
      print(y);
      i = i + 1;
    }
  `;
  assert.deepEqual(run(src), ['0', '10', '20']);
});

test('assigning to an undeclared variable throws', () => {
  assert.throws(() => run('x = 1;'));
});

// --- interpreter.js: functions and closures ---

test('a function returns nil implicitly when it falls off the end without a return', () => {
  assert.deepEqual(run('function f() { let x = 1; } print(f());'), ['nil']);
});

test('return exits a function immediately with its value', () => {
  const src = `
    function f(a, b) {
      if (a > b) { return a; }
      return b;
    }
    print(f(3, 7));
  `;
  assert.deepEqual(run(src), ['7']);
});

test('calling a function with the wrong number of arguments throws', () => {
  assert.throws(() => run('function f(a, b) { return a; } f(1);'));
  assert.throws(() => run('function f(a, b) { return a; } f(1, 2, 3);'));
});

test('calling a non-function value throws', () => {
  assert.throws(() => run('let x = 5; x();'));
});

test('recursion works correctly', () => {
  const src = `
    function fib(n) {
      if (n < 2) { return n; }
      return fib(n - 1) + fib(n - 2);
    }
    print(fib(10));
  `;
  assert.deepEqual(run(src), ['55']);
});

test('closures: two calls to a factory produce independently-stateful functions', () => {
  const src = `
    function makeCounter() {
      let n = 0;
      function inc() {
        n = n + 1;
        return n;
      }
      return inc;
    }
    let c1 = makeCounter();
    let c2 = makeCounter();
    print(c1());
    print(c1());
    print(c2());
    print(c1());
  `;
  assert.deepEqual(run(src), ['1', '2', '1', '3']);
});

test('a function captures variables from its defining (lexical) scope, not the caller\'s scope', () => {
  const src = `
    let secret = "outer";
    function reveal() {
      print(secret);
    }
    function callIt() {
      let secret = "inner-caller-scope";
      reveal();
    }
    callIt();
  `;
  assert.deepEqual(run(src), ['outer']);
});

// --- builtins.js ---

test('len() returns a string\'s length and throws for a non-string', () => {
  assert.deepEqual(run('print(len("hello"));'), ['5']);
  assert.throws(() => run('print(len(5));'));
});

// --- index.js: end-to-end pipeline ---

test('run() ties tokenizer/parser/interpreter together for a full program', () => {
  const src = `
    function sumTo(n) {
      let total = 0;
      let i = 1;
      while (i <= n) {
        total = total + i;
        i = i + 1;
      }
      return total;
    }
    print(sumTo(10));
    print("sum computed");
  `;
  assert.deepEqual(run(src), ['55', 'sum computed']);
});

test('a fresh Interpreter instance has independent state from a prior run() call', () => {
  const interp1 = new Interpreter();
  interp1.run(parse(tokenize('print(1);')));
  const interp2 = new Interpreter();
  interp2.run(parse(tokenize('print(2);')));
  assert.deepEqual(interp1.output, ['1']);
  assert.deepEqual(interp2.output, ['2']);
});
