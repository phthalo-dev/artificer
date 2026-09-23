import { defineChannel } from '../../api/define-channel.js';
import type { ArtificerChannel } from '../../api/types.js';
import { verifyDiscordSignature } from './verify.js';

const PING = 1;
const APPLICATION_COMMAND = 2;

const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;

export function discordChannel(): ArtificerChannel {
  return defineChannel({
    name: 'discord',
    description: 'Discord server integration via slash commands',

    verify: async (headers, body) => {
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (!publicKey) return false;
      return verifyDiscordSignature(publicKey, headers, body);
    },

    receive: async (payload) => {
      const type = payload.type as number;

      if (type === PING) {
        return {
          content: '',
          metadata: { channel: 'discord', _ping: true, _skip: true },
        };
      }

      if (type === APPLICATION_COMMAND) {
        const data = payload.data as Record<string, unknown>;
        const options =
          (data?.options as Array<{ name: string; value: string }>) ?? [];
        const messageOpt = options.find((o) => o.name === 'message');
        const content = messageOpt?.value ?? (data?.name as string) ?? '';
        const member = payload.member as Record<string, unknown> | undefined;
        const user = member?.user as Record<string, unknown> | undefined;

        return {
          content,
          metadata: {
            channel: 'discord',
            _async: true,
            channelId: payload.channel_id,
            userId: user?.id,
            username: user?.username,
            interactionToken: payload.token,
            interactionId: payload.id,
            command: data?.name,
            includeFullReceipt: /\bfull\s+receipt\b/i.test(content),
            originContent: content,
          },
        };
      }

      return { content: '', metadata: { channel: 'discord', _skip: true } };
    },

    format: async (output) => {
      if (output.metadata?._ping) {
        return { type: PONG };
      }

      if (output.metadata?._defer || output.content === '') {
        return { type: DEFERRED_CHANNEL_MESSAGE };
      }

      return {
        type: CHANNEL_MESSAGE,
        data: { content: output.content },
      };
    },
  });
}

export async function editDiscordResponse(
  interactionToken: string,
  content: string,
): Promise<void> {
  const appId = process.env.DISCORD_APP_ID;
  if (!appId) return;

  await fetch(
    `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
}
