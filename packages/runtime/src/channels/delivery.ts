import type { MessageChannelContext } from '../storage/types.js';
import { editDiscordResponse } from './adapters/discord.js';
import { postSlackReply } from './adapters/slack.js';

export async function deliverChannelMessage(
  context: MessageChannelContext,
  content: string,
): Promise<void> {
  if (context.name === 'slack') {
    const channelId = context.metadata.channelId;
    if (typeof channelId !== 'string' || !channelId) return;
    const threadTs =
      typeof context.metadata.threadTs === 'string'
        ? context.metadata.threadTs
        : undefined;
    await postSlackReply(channelId, content, threadTs);
    return;
  }

  if (context.name === 'discord') {
    const token = context.metadata.interactionToken;
    if (typeof token !== 'string' || !token) return;
    await editDiscordResponse(token, content);
  }
}
