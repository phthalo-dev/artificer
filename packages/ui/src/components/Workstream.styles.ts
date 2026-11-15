import { style, t } from '../styles/system';

/** Raw text / JSON preview block. */
export const preBlock = style('workstream-pre-block', {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: t.fontFamily.mono.var,
  fontSize: t.fontSize.sm.var,
});

export const clickableRow = style('workstream-clickable-row', {
  cursor: 'pointer',
});

/** Inbound (user) chat bubble: subtle tint so markdown keeps its own colours. */
export const chatLayout = style('workstream-chat-layout', {
  maxHeight: 'calc(100vh - 320px)',
});

/** Stat tiles: Var UI Grid's `auto` track minimum (240px) is too wide for 7 tiles. */
export const statGrid = style('workstream-stat-grid', {
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
});

export const cellMaxWidth = style('workstream-cell-max-width', {
  maxWidth: '320px',
});
