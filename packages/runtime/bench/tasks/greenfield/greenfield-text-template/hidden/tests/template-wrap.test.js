import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/template.js';
import { wrapText } from '../src/wrap.js';

test('render substitutes a top-level placeholder', () => {
  assert.equal(render('Hello, {{name}}!', { name: 'Ada' }), 'Hello, Ada!');
});

test('render substitutes a nested dotted-path placeholder', () => {
  assert.equal(
    render('Hi {{user.profile.name}}', { user: { profile: { name: 'Grace' } } }),
    'Hi Grace',
  );
});

test('render substitutes multiple placeholders and preserves literal text', () => {
  assert.equal(
    render('{{greeting}}, {{name}}! Today is {{day}}.', {
      greeting: 'Hello',
      name: 'Ada',
      day: 'Monday',
    }),
    'Hello, Ada! Today is Monday.',
  );
});

test('render renders a missing or undefined path as an empty string', () => {
  assert.equal(render('X[{{missing}}]Y', {}), 'X[]Y');
  assert.equal(render('X[{{a.b.c}}]Y', { a: {} }), 'X[]Y');
});

test('render coerces non-string values to strings', () => {
  assert.equal(render('count={{n}}', { n: 42 }), 'count=42');
  assert.equal(render('ok={{flag}}', { flag: false }), 'ok=false');
});

test('render trims whitespace inside the braces', () => {
  assert.equal(render('{{  name  }}', { name: 'Ada' }), 'Ada');
});

test('render applies a single filter', () => {
  assert.equal(render('{{name|upper}}', { name: 'ada' }), 'ADA');
  assert.equal(render('{{name|lower}}', { name: 'ADA' }), 'ada');
});

test('render chains multiple filters left to right', () => {
  assert.equal(render('{{name|trim|upper}}', { name: '  ada  ' }), 'ADA');
});

test('render ignores an unknown filter name (leaves the value as-is)', () => {
  assert.equal(render('{{name|shout}}', { name: 'ada' }), 'ada');
});

test('wrapText wraps greedily so no line exceeds width (except an unsplittable long word)', () => {
  const lines = wrapText('the quick brown fox jumps over the lazy dog', 10);
  for (const line of lines) assert.ok(line.length <= 10, `line too long: "${line}"`);
  assert.deepEqual(lines.join(' ').split(/\s+/), 'the quick brown fox jumps over the lazy dog'.split(' '));
});

test('wrapText collapses irregular whitespace (including newlines) when reflowing', () => {
  const lines = wrapText('the   quick\nbrown  fox', 100);
  assert.deepEqual(lines, ['the quick brown fox']);
});

test('wrapText returns an empty array for empty or whitespace-only input', () => {
  assert.deepEqual(wrapText('', 10), []);
  assert.deepEqual(wrapText('   \n  ', 10), []);
});

test('wrapText puts a single word longer than width on its own (overflowing) line', () => {
  const lines = wrapText('a supercalifragilisticexpialidocious word', 10);
  assert.ok(lines.includes('supercalifragilisticexpialidocious'));
});
