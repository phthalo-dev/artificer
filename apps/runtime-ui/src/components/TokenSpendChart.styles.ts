import { styles } from '../ds/styles';
import { color } from '../ds/tokens';

export const legendSwatch = styles.class('chart-legend-swatch', {
  borderRadius: '2px',
});

export const legendSwatchSm = styles.class('chart-legend-swatch-sm', {
  borderRadius: '2px',
  width: '8px',
  height: '8px',
});

export const legendSwatchMd = styles.class('chart-legend-swatch-md', {
  borderRadius: '2px',
  width: '10px',
  height: '10px',
});

export const roleBarTrack = styles.class('chart-role-bar-track', {
  display: 'flex',
  height: '28px',
  overflow: 'hidden',
  backgroundColor: color.grayLight,
});

export const roleBarSegment = styles.class('chart-role-bar-segment', {
  height: '100%',
  opacity: 0.9,
});

export const stackedBarEmpty = styles.class('chart-stacked-bar-empty', {
  flex: '0 0 auto',
  backgroundColor: color.grayBg,
});

export const stackedBar = styles.class('chart-stacked-bar', {
  flex: '0 0 auto',
  display: 'flex',
  flexDirection: 'column-reverse',
  overflow: 'hidden',
});

export const stackedBarLayer = styles.class('chart-stacked-bar-layer', {});

export const timelineScroll = styles.class('chart-timeline-scroll', {
  overflowX: 'auto',
  padding: '4px 0',
});
