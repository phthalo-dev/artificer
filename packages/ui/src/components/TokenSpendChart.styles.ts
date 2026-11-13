import { style, t } from '../styles/system';

export const eyebrow = style('chart-eyebrow', {
  textTransform: 'uppercase',
  letterSpacing: t.letterSpacing.caps.var,
});

export const legendSwatchSm = style('chart-legend-swatch-sm', {
  display: 'inline-block',
  borderRadius: t.radius.sm.var,
  width: '0.5rem',
  height: '0.5rem',
  flexShrink: 0,
});

export const legendSwatchMd = style('chart-legend-swatch-md', {
  display: 'inline-block',
  borderRadius: t.radius.sm.var,
  width: '0.625rem',
  height: '0.625rem',
  flexShrink: 0,
});

export const roleBarTrack = style('chart-role-bar-track', {
  display: 'flex',
  height: '1.75rem',
  overflow: 'hidden',
  borderRadius: t.radius.sm.var,
  backgroundColor: t.color.track.default.var,
});

export const roleBarSegment = style('chart-role-bar-segment', {
  height: '100%',
  opacity: 0.9,
});

export const stackedBarEmpty = style('chart-stacked-bar-empty', {
  flex: '0 0 auto',
  backgroundColor: t.color.track.default.var,
});

export const stackedBar = style('chart-stacked-bar', {
  flex: '0 0 auto',
  display: 'flex',
  flexDirection: 'column-reverse',
  overflow: 'hidden',
});

export const timelineScroll = style('chart-timeline-scroll', {
  display: 'flex',
  alignItems: 'flex-end',
  gap: '2px',
  overflowX: 'auto',
  paddingBlock: t.space.xxs.var,
});
