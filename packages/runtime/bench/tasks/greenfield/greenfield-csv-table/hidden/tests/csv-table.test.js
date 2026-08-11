import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';
import { Table } from '../src/table.js';

test('parseCsv parses a simple header + rows into objects', () => {
  const rows = parseCsv('name,age\nAda,30\nGrace,85\n');
  assert.deepEqual(rows, [
    { name: 'Ada', age: '30' },
    { name: 'Grace', age: '85' },
  ]);
});

test('parseCsv works without a trailing newline', () => {
  const rows = parseCsv('name,age\nAda,30');
  assert.deepEqual(rows, [{ name: 'Ada', age: '30' }]);
});

test('parseCsv returns an empty array for empty or header-only input', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('   \n  '), []);
  assert.deepEqual(parseCsv('name,age\n'), []);
});

test('parseCsv handles quoted fields containing commas', () => {
  const rows = parseCsv('name,city\n"Doe, John","New York"\n');
  assert.deepEqual(rows, [{ name: 'Doe, John', city: 'New York' }]);
});

test('parseCsv handles quoted fields containing embedded newlines', () => {
  const rows = parseCsv('name,note\nAda,"line one\nline two"\n');
  assert.deepEqual(rows, [{ name: 'Ada', note: 'line one\nline two' }]);
});

test('parseCsv unescapes doubled quotes inside a quoted field', () => {
  const rows = parseCsv('name,quote\nAda,"She said ""hi"""\n');
  assert.deepEqual(rows, [{ name: 'Ada', quote: 'She said "hi"' }]);
});

const SAMPLE = () =>
  new Table(
    parseCsv(
      'name,team,score\n' +
        'Ada,red,30\n' +
        'Grace,blue,85\n' +
        'Linus,red,10\n' +
        'Margaret,blue,42\n',
    ),
  );

test('Table#filter returns a new Table with only matching rows', () => {
  const t = SAMPLE();
  const red = t.filter((row) => row.team === 'red');
  assert.equal(red.rows.length, 2);
  assert.deepEqual(
    red.rows.map((r) => r.name),
    ['Ada', 'Linus'],
  );
  // Original table is untouched.
  assert.equal(t.rows.length, 4);
});

test('Table#sortBy sorts numeric-looking columns numerically, ascending by default', () => {
  const t = SAMPLE();
  const sorted = t.sortBy('score');
  assert.deepEqual(
    sorted.rows.map((r) => r.name),
    ['Linus', 'Ada', 'Margaret', 'Grace'],
  );
});

test('Table#sortBy supports desc and is stable for ties', () => {
  const t = new Table([
    { name: 'a', score: '5' },
    { name: 'b', score: '5' },
    { name: 'c', score: '1' },
  ]);
  const desc = t.sortBy('score', { desc: true });
  assert.deepEqual(
    desc.rows.map((r) => r.name),
    ['a', 'b', 'c'],
  );
});

test('Table#groupBy groups rows by key, preserving first-seen key order', () => {
  const t = SAMPLE();
  const groups = t.groupBy('team');
  assert.deepEqual([...groups.keys()], ['red', 'blue']);
  assert.deepEqual(
    groups.get('red').map((r) => r.name),
    ['Ada', 'Linus'],
  );
  assert.deepEqual(
    groups.get('blue').map((r) => r.name),
    ['Grace', 'Margaret'],
  );
});

test('Table#select projects only the requested columns', () => {
  const t = SAMPLE();
  const projected = t.select(['name', 'score']);
  assert.deepEqual(projected.rows[0], { name: 'Ada', score: '30' });
  assert.equal('team' in projected.rows[0], false);
});

test('Table methods chain without mutating the original rows array', () => {
  const t = SAMPLE();
  const result = t
    .filter((r) => r.team === 'blue')
    .sortBy('score', { desc: true })
    .select(['name']);
  assert.deepEqual(result.rows, [{ name: 'Grace' }, { name: 'Margaret' }]);
  assert.equal(t.rows.length, 4);
});
