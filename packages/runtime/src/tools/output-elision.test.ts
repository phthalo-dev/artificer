import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { elideOutput, ELISION_THRESHOLD } from './output-elision.js';

describe('elideOutput', () => {
  it('returns short output unchanged', () => {
    const text = 'hello world';
    assert.equal(elideOutput(text), text);
  });

  it('elides long output with head and tail', () => {
    const text = 'x'.repeat(ELISION_THRESHOLD + 100);
    const out = elideOutput(text);
    assert.ok(out.startsWith('x'.repeat(5000)));
    assert.ok(out.includes('characters elided'));
    assert.ok(out.endsWith('x'.repeat(5000)));
  });
});
