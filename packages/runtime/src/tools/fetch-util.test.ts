import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractTitle, htmlToText, truncateText } from './fetch-util.js';

test('extractTitle pulls and decodes the <title>', () => {
  assert.equal(
    extractTitle('<html><head><title>Hello &amp; Bye</title></head>'),
    'Hello & Bye',
  );
  assert.equal(extractTitle('<html><body>no title</body></html>'), undefined);
});

test('htmlToText strips scripts/styles/tags and decodes entities', () => {
  const html =
    '<html><head><style>.a{}</style></head><body><h1>Title</h1><script>var x=1;</script><p>Hello&nbsp;world &amp; more</p></body></html>';
  const text = htmlToText(html);
  assert.ok(!text.includes('var x'));
  assert.ok(!text.includes('.a{}'));
  assert.ok(text.includes('Title'));
  assert.ok(text.includes('Hello world & more'));
});

test('truncateText caps length and flags truncation', () => {
  const { text, truncated } = truncateText('abcdef', 3);
  assert.equal(truncated, true);
  assert.ok(text.startsWith('abc'));
  assert.equal(truncateText('ab', 3).truncated, false);
});
