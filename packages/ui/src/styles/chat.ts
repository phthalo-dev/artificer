import { style, t } from './system';

/**
 * Var UI's user ChatMessageBubble is a solid accent fill. Markdown and links
 * inside it keep their own colours and become unreadable, so user bubbles use
 * the subtle accent wash instead.
 */
export const userBubble = style('chat-user-bubble', {
  backgroundColor: t.color.tone.accent.subtleBackground.var,
  color: t.color.text.primary.var,
});
