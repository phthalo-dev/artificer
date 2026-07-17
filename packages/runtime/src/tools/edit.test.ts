import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replace } from './edit.js';

test('SimpleReplacer applies an exact unique match', () => {
  const out = replace(
    'const a = 1;\nconst b = 2;\n',
    'const b = 2;',
    'const b = 3;',
  );
  assert.equal(out, 'const a = 1;\nconst b = 3;\n');
});

test('throws when old_string is not found', () => {
  assert.throws(
    () => replace('hello world\n', 'goodbye', 'hi'),
    /Could not find old_string/,
  );
});

test('throws on multiple matches without replace_all', () => {
  assert.throws(
    () => replace('x = 1\nx = 1\n', 'x = 1', 'x = 2'),
    /multiple matches/,
  );
});

test('replace_all replaces every occurrence', () => {
  const out = replace('x = 1\nx = 1\n', 'x = 1', 'x = 2', true);
  assert.equal(out, 'x = 2\nx = 2\n');
});

test('throws when old and new strings are identical', () => {
  assert.throws(() => replace('a\n', 'a', 'a'), /identical/);
});

test('LineTrimmedReplacer matches despite leading-whitespace drift', () => {
  // File has 4-space indent; the search over-indents (8 spaces) so it is not a
  // substring — only the trimmed-line matcher can locate it.
  const content = 'function f() {\n    return 1;\n}\n';
  const out = replace(content, '        return 1;', '    return 2;');
  assert.equal(out, 'function f() {\n    return 2;\n}\n');
});

test('IndentationFlexibleReplacer matches a dedented multi-line block', () => {
  const content = ['class A:', '    def f(self):', '        return 1', ''].join(
    '\n',
  );
  // Search block is dedented relative to the file.
  const search = ['def f(self):', '    return 1'].join('\n');
  const out = replace(content, search, 'def f(self):\n    return 2');
  assert.ok(out.includes('return 2'));
  assert.ok(!out.includes('return 1'));
});

test('WhitespaceNormalizedReplacer matches collapsed inner whitespace', () => {
  const content = 'const   x    =     1;\n';
  const out = replace(content, 'const x = 1;', 'const x = 2;');
  assert.equal(out, 'const x = 2;\n');
});

test('BlockAnchorReplacer matches via first/last anchors with drift in middle', () => {
  const content = [
    'function compute() {',
    '  const total = a + b + c;',
    '  return total;',
    '}',
    '',
  ].join('\n');
  // Middle line differs slightly from the file; anchors match exactly.
  const search = [
    'function compute() {',
    '  const total = a+b+c;',
    '  return total;',
    '}',
  ].join('\n');
  const replacement = ['function compute() {', '  return 0;', '}'].join('\n');
  const out = replace(content, search, replacement);
  assert.ok(out.includes('return 0;'));
  assert.ok(!out.includes('const total'));
});
