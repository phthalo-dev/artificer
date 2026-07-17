import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySlackSignature } from './verify.js';

describe('verifySlackSignature', () => {
  const secret = 'test-signing-secret';

  it('accepts a valid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"event_callback","event":{"text":"hello"}}';
    const sig =
      'v0=' +
      createHmac('sha256', secret)
        .update(`v0:${timestamp}:${body}`)
        .digest('hex');

    const result = verifySlackSignature(
      secret,
      {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': sig,
      },
      body,
    );

    assert.equal(result, true);
  });

  it('rejects an invalid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"text":"hello"}';

    const result = verifySlackSignature(
      secret,
      {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=invalid',
      },
      body,
    );

    assert.equal(result, false);
  });

  it('rejects a stale timestamp (replay attack)', () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const body = '{}';
    const sig =
      'v0=' +
      createHmac('sha256', secret)
        .update(`v0:${staleTimestamp}:${body}`)
        .digest('hex');

    const result = verifySlackSignature(
      secret,
      {
        'x-slack-request-timestamp': staleTimestamp,
        'x-slack-signature': sig,
      },
      body,
    );

    assert.equal(result, false);
  });

  it('rejects when headers are missing', () => {
    const result = verifySlackSignature(secret, {}, '{}');
    assert.equal(result, false);
  });
});
