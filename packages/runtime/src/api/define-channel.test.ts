import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineChannel } from './define-channel.js';

describe('defineChannel', () => {
  it('creates a channel with receive and format', async () => {
    const channel = defineChannel({
      name: 'slack',
      description: 'Slack integration',
      receive: async (payload) => ({
        content: payload.text as string,
        metadata: { channel: 'slack' },
      }),
      format: async (output) => ({ text: output.content }),
    });

    assert.equal(channel.name, 'slack');
    const msg = await channel.receive({ text: 'hello' });
    assert.equal(msg.content, 'hello');
    const fmt = await channel.format({ content: 'world' });
    assert.equal(fmt.text, 'world');
  });

  it('supports webhook verification', async () => {
    const channel = defineChannel({
      name: 'secure',
      description: 'Secure channel',
      verify: async (headers) => headers['x-token'] === 'valid',
      receive: async (p) => ({ content: String(p.text) }),
      format: async (o) => ({ text: o.content }),
    });

    const ok = await channel.definition.verify!({ 'x-token': 'valid' }, '');
    const bad = await channel.definition.verify!({ 'x-token': 'bad' }, '');
    assert.equal(ok, true);
    assert.equal(bad, false);
  });
});
