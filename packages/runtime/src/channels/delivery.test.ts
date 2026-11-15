import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';
import { deliverChannelMessage } from './delivery.js';

describe('deliverChannelMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts Slack replies to the originating channel thread', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      fetchMock as unknown as typeof fetch,
    );

    await deliverChannelMessage(
      {
        name: 'slack',
        metadata: {
          channelId: 'C123',
          threadTs: '111.222',
        },
      },
      'Workstream complete.',
    );

    assert.equal(fetchMock.mock.calls.length, 1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    assert.match(String(init?.body), /C123/);
    assert.match(String(init?.body), /111.222/);
    assert.match(String(init?.body), /Workstream complete/);
  });

  it('edits Discord interaction responses when a token is present', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      fetchMock as unknown as typeof fetch,
    );
    process.env.DISCORD_APP_ID = 'app123';

    await deliverChannelMessage(
      {
        name: 'discord',
        metadata: {
          interactionToken: 'token456',
        },
      },
      'Done.',
    );

    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    assert.match(url, /app123\/token456/);
    assert.match(String(init?.body), /Done/);
  });
});
