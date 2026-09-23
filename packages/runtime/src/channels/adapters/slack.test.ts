import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slackChannel } from './slack.js';

describe('slackChannel', () => {
  it('creates a channel named slack', () => {
    const channel = slackChannel();
    assert.equal(channel.name, 'slack');
  });

  it('classifies a DM as interaction type "dm"', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'event_callback',
      event: {
        type: 'message',
        channel_type: 'im',
        text: 'Hey, can you fix the auth bug?',
        channel: 'D123ABC',
        user: 'U456DEF',
        ts: '1355517523.000005',
      },
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, 'Hey, can you fix the auth bug?');
    assert.equal(msg.metadata?.interaction, 'dm');
    assert.equal(msg.metadata?.channelId, 'D123ABC');
    assert.equal(msg.metadata?._async, true);
  });

  it('classifies an @mention as interaction type "mention"', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'event_callback',
      event: {
        type: 'app_mention',
        text: '<@U_BOT_ID> can you check the CI failures?',
        channel: 'C123ABC',
        user: 'U456DEF',
        ts: '1355517523.000005',
        thread_ts: '1355517520.000001',
      },
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, '<@U_BOT_ID> can you check the CI failures?');
    assert.equal(msg.metadata?.interaction, 'mention');
    assert.equal(msg.metadata?.threadTs, '1355517520.000001');
  });

  it('classifies a channel message as interaction type "ambient"', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'event_callback',
      event: {
        type: 'message',
        channel_type: 'channel',
        text: 'The deploy is broken again',
        channel: 'C123ABC',
        user: 'U456DEF',
        ts: '1355517523.000005',
      },
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.metadata?.interaction, 'ambient');
  });

  it('handles url_verification challenge', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'url_verification',
      challenge: 'test-challenge-string',
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, '');
    assert.equal(msg.metadata?._challenge, 'test-challenge-string');
  });

  it('formats engine output for Slack chat.postMessage', async () => {
    const channel = slackChannel();
    const formatted = await channel.format({
      content: 'PR opened: #42',
      metadata: {
        channelId: 'C123ABC',
        threadTs: '1355517520.000001',
      },
    });

    assert.equal(formatted.channel, 'C123ABC');
    assert.equal(formatted.text, 'PR opened: #42');
    assert.equal(formatted.thread_ts, '1355517520.000001');
  });

  it('skips bot messages to prevent loops', async () => {
    const channel = slackChannel();
    const payload = {
      type: 'event_callback',
      event: {
        type: 'message',
        text: 'I am a bot',
        channel: 'C123',
        bot_id: 'B999',
        ts: '123.456',
      },
    };

    const msg = await channel.receive(payload);
    assert.equal(msg.content, '');
    assert.equal(msg.metadata?._skip, true);
  });
});
