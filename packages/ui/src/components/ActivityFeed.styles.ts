import { styles } from '../ds/styles';
import { color, space } from '../ds/tokens';

export const feedRoot = styles.class('activity-feed-root', {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
});

export const feedHeader = styles.class('activity-feed-header', {
  padding: '0 0 8px',
  borderBottom: `1px solid ${color.border}`,
  marginBottom: '8px',
  flexShrink: 0,
  fontWeight: 600,
  fontSize: '13px',
});

export const feedScroll = styles.class('activity-feed-scroll', {
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
});

export const feedEmpty = styles.class('activity-feed-empty', {
  padding: '8px 0',
});

export const feedRow = styles.class('activity-feed-row', {
  padding: '3px 0',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: space.xs,
});

export const feedRowMain = styles.class('activity-feed-row-main', {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  flex: 1,
  gap: space.xs,
});

export const feedDot = styles.class('activity-feed-dot', {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  flexShrink: 0,
});

export const feedLabel = styles.class('activity-feed-label', {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: 'monospace',
  fontSize: '11px',
});

export const feedTime = styles.class('activity-feed-time', {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  fontSize: '11px',
  color: color.dimmed,
});
