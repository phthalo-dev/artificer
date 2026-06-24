import { defineChannel } from '../../api/define-channel.js';
import type { ArtificerChannel } from '../../api/types.js';
import { verifySlackSignature } from './verify.js';

function classifyInteraction(event: Record<string, unknown>): string {
  if (event.type === 'app_mention') return 'mention';
  if (event.channel_type === 'im') return 'dm';
  return 'ambient';
}

export function slackChannel(): ArtificerChannel {
  return defineChannel({
    name: 'slack',
    description: 'Slack workspace integration — DMs, @mentions, and channel messages',

    verify: async (headers, body) => {
      const secret = process.env.SLACK_SIGNING_SECRET;
      if (!secret) return false;
      return verifySlackSignature(secret, headers, body);
    },

    receive: async (payload) => {
      if (payload.type === 'url_verification') {
        return {
          content: '',
          metadata: {
            channel: 'slack',
            _challenge: payload.challenge,
            _skip: true,
          },
        };
      }

      const event = payload.event as Record<string, unknown> | undefined;
      if (!event) {
        return { content: '', metadata: { channel: 'slack', _skip: true } };
      }

      if (event.bot_id) {
        return { content: '', metadata: { channel: 'slack', _skip: true } };
      }

      const interaction = classifyInteraction(event);

      return {
        content: (event.text as string) ?? '',
        metadata: {
          channel: 'slack',
          interaction,
          channelId: event.channel,
          userId: event.user,
          threadTs: event.thread_ts ?? event.ts,
          messageTs: event.ts,
          channelType: event.channel_type,
        },
      };
    },

    format: async (output) => ({
      channel: output.metadata?.channelId,
      text: output.content,
      thread_ts: output.metadata?.threadTs,
    }),
  });
}

export async function postSlackReply(
  channel: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, text, thread_ts: threadTs }),
  });
}

export async function updateSlackStatus(
  statusText: string,
  statusEmoji?: string,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  await fetch('https://slack.com/api/users.profile.set', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profile: {
        status_text: statusText,
        status_emoji: statusEmoji ?? ':robot_face:',
      },
    }),
  });
}
