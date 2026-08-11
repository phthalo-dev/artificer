import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../src/tokenizer.js';
import { parse } from '../src/parser.js';
import { VM } from '../src/vm.js';
import { compileAndRun } from '../src/index.js';

// --- tokenizer.js ---

test('tokenize skips blank lines and whole-line comments', () => {
  const tokens = tokenize('PUSH 1\n\n# a comment\n  \nPUSH 2');
  assert.deepEqual(
    tokens.map((t) => t.op ?? t.name),
    ['PUSH', 'PUSH'],
  );
});

test('tokenize recognizes a label line distinctly from an instruction', () => {
  const tokens = tokenize('loop:\nPUSH 1');
  assert.deepEqual(tokens[0], { type: 'label', name: 'loop' });
  assert.equal(tokens[1].type, 'instruction');
});

test('tokenize captures the opcode and single argument separately', () => {
  const tokens = tokenize('PUSH 42');
  assert.equal(tokens[0].op, 'PUSH');
  assert.equal(tokens[0].arg, '42');
});

test('tokenize leaves arg undefined for a no-argument line', () => {
  const tokens = tokenize('ADD');
  assert.equal(tokens[0].op, 'ADD');
  assert.equal(tokens[0].arg, undefined);
});

test('tokenize throws on a line with more than one argument token', () => {
  assert.throws(() => tokenize('PUSH 1 2'));
});

// --- parser.js ---

test('parse converts a PUSH argument to a number', () => {
  const { instructions } = parse(tokenize('PUSH 5'));
  assert.equal(instructions[0].arg, 5);
  assert.equal(typeof instructions[0].arg, 'number');
});

test('parse throws when PUSH is given a non-numeric argument', () => {
  assert.throws(() => parse(tokenize('PUSH abc')));
});

test('parse throws when a name-argument op is missing its argument', () => {
  assert.throws(() => parse(tokenize('STORE')));
});

test('parse throws when a no-argument op is given an argument', () => {
  assert.throws(() => parse(tokenize('ADD 1')));
});

test('parse throws on an unrecognized opcode', () => {
  assert.throws(() => parse(tokenize('NOPE')));
});

test('parse records each label at the index of the instruction that follows it', () => {
  const { labels } = parse(tokenize('PUSH 1\nloop:\nPUSH 2\nADD'));
  assert.equal(labels.get('loop'), 1);
});

test('parse throws on a duplicate label', () => {
  assert.throws(() => parse(tokenize('a:\nPUSH 1\na:\nPUSH 2')));
});

test('parse throws when JMP/JZ targets a label that is never defined', () => {
  assert.throws(() => parse(tokenize('JMP nowhere')));
  assert.throws(() => parse(tokenize('PUSH 0\nJZ nowhere')));
});

// --- vm.js: opcode semantics ---

function run(source) {
  return new VM().run(parse(tokenize(source)));
}

test('PUSH/ADD/SUB/MUL compute correctly and DIV truncates toward zero', () => {
  assert.deepEqual(run('PUSH 2\nPUSH 3\nADD\nPRINT'), [5]);
  assert.deepEqual(run('PUSH 5\nPUSH 3\nSUB\nPRINT'), [2]);
  assert.deepEqual(run('PUSH 4\nPUSH 3\nMUL\nPRINT'), [12]);
  assert.deepEqual(run('PUSH 7\nPUSH 2\nDIV\nPRINT'), [3]);
  assert.deepEqual(run('PUSH -7\nPUSH 2\nDIV\nPRINT'), [-3]);
});

test('DIV by zero throws a specific error, distinct from stack underflow', () => {
  assert.throws(() => run('PUSH 1\nPUSH 0\nDIV'), /division by zero/i);
});

test('arithmetic ops pop operands in the order pushed: SUB/DIV are not commutative', () => {
  // a=first pushed, b=second pushed → a OP b (not b OP a)
  assert.deepEqual(run('PUSH 10\nPUSH 3\nSUB\nPRINT'), [7]);
  assert.deepEqual(run('PUSH 10\nPUSH 3\nDIV\nPRINT'), [3]);
});

test('POP, ADD, DUP, STORE, PRINT, JZ all throw stack underflow on an empty/insufficient stack', () => {
  assert.throws(() => run('POP'));
  assert.throws(() => run('PUSH 1\nADD'));
  assert.throws(() => run('DUP'));
  assert.throws(() => run('STORE x'));
  assert.throws(() => run('PRINT'));
  assert.throws(() => run('JZ somewhere\nsomewhere:\nHALT'));
});

test('DUP duplicates without consuming the original', () => {
  assert.deepEqual(run('PUSH 9\nDUP\nADD\nPRINT'), [18]);
});

test('STORE then LOAD round-trips a value, and STORE consumes the stack value', () => {
  assert.deepEqual(run('PUSH 7\nSTORE x\nLOAD x\nLOAD x\nADD\nPRINT'), [14]);
});

test('LOAD of a never-stored variable throws', () => {
  assert.throws(() => run('LOAD x'), /undefined variable/i);
});

test('HALT stops execution immediately, later instructions never run', () => {
  assert.deepEqual(run('PUSH 1\nPRINT\nHALT\nPUSH 2\nPRINT'), [1]);
});

test('a program with no HALT terminates cleanly when it falls off the end', () => {
  assert.deepEqual(run('PUSH 1\nPRINT'), [1]);
});

test('JMP unconditionally jumps to the label', () => {
  assert.deepEqual(run('JMP skip\nPUSH 999\nPRINT\nskip:\nPUSH 1\nPRINT'), [1]);
});

test('JZ jumps only when the popped value is zero, and consumes it either way', () => {
  assert.deepEqual(run('PUSH 0\nJZ target\nPUSH 111\nPRINT\ntarget:\nPUSH 222\nPRINT'), [222]);
  assert.deepEqual(run('PUSH 1\nJZ target\nPUSH 111\nPRINT\ntarget:\nPUSH 222\nPRINT'), [111, 222]);
});

test('a countdown loop via JMP/JZ prints the expected sequence', () => {
  const source = [
    'PUSH 3',
    'STORE n',
    'loop:',
    'LOAD n',
    'JZ done',
    'LOAD n',
    'PRINT',
    'LOAD n',
    'PUSH 1',
    'SUB',
    'STORE n',
    'JMP loop',
    'done:',
    'HALT',
  ].join('\n');
  assert.deepEqual(run(source), [3, 2, 1]);
});

// --- index.js: end-to-end pipeline ---

test('compileAndRun ties tokenizer/parser/vm together for a full program', () => {
  const out = compileAndRun('PUSH 2\nPUSH 3\nMUL\nPUSH 4\nADD\nPRINT');
  assert.deepEqual(out, [10]);
});

test('compileAndRun propagates a parse-time error (bad opcode) all the way out', () => {
  assert.throws(() => compileAndRun('BOGUS 1'));
});

test('compileAndRun propagates a runtime error (division by zero) all the way out', () => {
  assert.throws(() => compileAndRun('PUSH 5\nPUSH 0\nDIV'), /division by zero/i);
});
