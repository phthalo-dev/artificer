import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hello } from '../src/hello.js';

test('hello greets the supplied name', () => {
  assert.equal(hello('Ada'), 'Hello, Ada!');
});
