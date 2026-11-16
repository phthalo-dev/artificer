import { style, t } from './system';

/** Small uppercase section label ("Summary", "Steps", …). */
export const eyebrow = style('eyebrow', {
  textTransform: 'uppercase',
  letterSpacing: t.letterSpacing.caps.var,
});

/** Preformatted text that preserves newlines. */
export const preWrap = style('pre-wrap', {
  whiteSpace: 'pre-wrap',
});
