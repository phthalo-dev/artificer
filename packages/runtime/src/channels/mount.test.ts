import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { mountChannels } from './mount.js';
import { defineChannel } from '../api/define-channel.js';

describe('mountChannels', () => {
  it('mounts a channel as a POST route', async () => {
    const app = new Hono();
    const channel = defineChannel({
      name: 'test',
      description: 'Test channel',
      receive: async (payload) => ({
        content: `received: ${payload.text}`,
        metadata: { channel: 'test' },
      }),
      format: async (output) => ({ response: output.content }),
    });

    const messages: string[] = [];
    const mockEngine = {
      receiveMessage: async (content: string) => {
        messages.push(content);
        return {
          id: 'msg_1',
          direction: 'inbound' as const,
          content,
          createdAt: '',
        };
      },
    };

    mountChannels(app, [channel], mockEngine as any);

    const res = await app.request('/channels/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello from test' }),
    });

    assert.equal(res.status, 200);
    assert.equal(messages.length, 1);
    assert.equal(messages[0], 'received: hello from test');
  });

  it('rejects when verification fails', async () => {
    const app = new Hono();
    const channel = defineChannel({
      name: 'secure',
      description: 'Verified channel',
      verify: async (headers) => headers['x-secret'] === 'valid',
      receive: async (payload) => ({ content: String(payload.text) }),
      format: async (output) => ({ text: output.content }),
    });

    mountChannels(app, [channel], { receiveMessage: async () => ({}) } as any);

    const res = await app.request('/channels/secure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });

    assert.equal(res.status, 401);
  });

  it('passes verification with correct header', async () => {
    const app = new Hono();
    const channel = defineChannel({
      name: 'secure',
      description: 'Verified channel',
      verify: async (headers) => headers['x-secret'] === 'valid',
      receive: async (payload) => ({ content: String(payload.text) }),
      format: async (output) => ({ text: output.content }),
    });

    mountChannels(app, [channel], {
      receiveMessage: async (content: string) => ({
        id: 'msg_1',
        direction: 'inbound',
        content,
        createdAt: '',
      }),
    } as any);

    const res = await app.request('/channels/secure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-secret': 'valid',
      },
      body: JSON.stringify({ text: 'hello' }),
    });

    assert.equal(res.status, 200);
  });

  it('handles _skip metadata by returning ok without calling engine', async () => {
    const app = new Hono();
    const channel = defineChannel({
      name: 'skip-test',
      description: 'Skip test',
      receive: async () => ({
        content: '',
        metadata: { _skip: true },
      }),
      format: async (output) => ({ text: output.content }),
    });

    let engineCalled = false;
    mountChannels(app, [channel], {
      receiveMessage: async () => {
        engineCalled = true;
        return {};
      },
    } as any);

    const res = await app.request('/channels/skip-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 200);
    assert.equal(engineCalled, false);
  });
});
