import { style, t } from '../styles/system';

export const feedRoot = style('activity-feed-root', {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  padding: t.space.sm.var,
});

export const feedHeader = style('activity-feed-header', {
  paddingBottom: t.space.xs.var,
  borderBottom: `1px solid ${t.color.border.default.var}`,
  marginBottom: t.space.xs.var,
  flexShrink: 0,
});

export const feedScroll = style('activity-feed-scroll', {
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
});

export const feedRow = style('activity-feed-row', {
  padding: '3px 0',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: t.space.xxs.var,
});

export const feedRowMain = style('activity-feed-row-main', {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  flex: 1,
  gap: t.space.xxs.var,
});

export const feedDot = style('activity-feed-dot', {
  width: '6px',
  height: '6px',
  borderRadius: t.radius.full.var,
  flexShrink: 0,
});

export const feedLabel = style('activity-feed-label', {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: t.fontFamily.mono.var,
  fontSize: t.fontSize.xs.var,
});

export const feedTime = style('activity-feed-time', {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  fontSize: t.fontSize.xs.var,
  color: t.color.text.secondary.var,
});

export const feedEmpty = style('activity-feed-empty', {
  padding: `${t.space.xs.var} 0`,
});
