import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { describe, it } from 'vitest';
import { defineChannel } from '../api/define-channel.js';
import { mountChannels } from './mount.js';

describe('mountChannels async delivery', () => {
  it('acks async channels without waiting for the engine response body', async () => {
    const app = new Hono();
    const channel = defineChannel({
      name: 'slack-like',
      description: 'Async channel',
      receive: async (payload) => ({
        content: String(payload.text),
        metadata: {
          channel: 'slack',
          _async: true,
          channelId: 'C123',
          threadTs: '111.222',
          originContent: String(payload.text),
        },
      }),
      format: async (output) => ({
        ok: output.metadata?._async ? true : false,
        text: output.content,
      }),
    });

    let receivedChannelContext: unknown;
    const mockEngine = {
      receiveMessage: async (content: string, channelContext?: unknown) => {
        receivedChannelContext = channelContext;
        return {
          id: 'msg_1',
          direction: 'inbound' as const,
          content,
          createdAt: '',
        };
      },
    };

    mountChannels(app, [channel], mockEngine as never);

    const res = await app.request('/channels/slack-like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'fix the auth bug' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, text: '' });
    assert.deepEqual(receivedChannelContext, {
      name: 'slack',
      metadata: {
        channel: 'slack',
        _async: true,
        channelId: 'C123',
        threadTs: '111.222',
        originContent: 'fix the auth bug',
      },
      includeFullReceipt: false,
      originContent: 'fix the auth bug',
    });
  });
});
