import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { discordChannel } from './discord.js';

describe('discordChannel', () => {
  it('creates a channel named discord', () => {
    const channel = discordChannel();
    assert.equal(channel.name, 'discord');
  });

  it('handles PING interaction', async () => {
    const channel = discordChannel();
    const payload = { type: 1 };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, '');
    assert.equal(msg.metadata?._ping, true);
  });

  it('normalizes an APPLICATION_COMMAND interaction', async () => {
    const channel = discordChannel();
    const payload = {
      type: 2,
      data: {
        name: 'ask',
        options: [{ name: 'message', type: 3, value: 'Fix the auth bug' }],
      },
      channel_id: '444555666',
      member: {
        user: { id: '777888999', username: 'danny' },
      },
      token: 'interaction_token_abc',
      id: 'interaction_id_123',
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, 'Fix the auth bug');
    assert.equal(msg.metadata?.channelId, '444555666');
    assert.equal(msg.metadata?.username, 'danny');
    assert.equal(msg.metadata?.interactionToken, 'interaction_token_abc');
  });

  it('formats a deferred acknowledgement', async () => {
    const channel = discordChannel();
    const formatted = await channel.format({
      content: '',
      metadata: { _defer: true },
    });

    assert.equal(formatted.type, 5);
  });

  it('formats a direct reply', async () => {
    const channel = discordChannel();
    const formatted = await channel.format({
      content: 'Done! PR #42 opened.',
    });

    assert.equal(formatted.type, 4);
    assert.deepEqual(formatted.data, { content: 'Done! PR #42 opened.' });
  });
});
