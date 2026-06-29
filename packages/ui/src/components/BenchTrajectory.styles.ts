import { styles } from '../ds/styles';
import { color, space } from '../ds/tokens';

export const stepHeader = styles.class('bench-step-header', {
  width: '100%',
  display: 'flex',
  padding: space.sm,
  '&[data-hovered]': { background: color.grayLight },
});

export const fullWidth = styles.class('bench-full-width', {
  width: '100%',
});

export const minWidthZero = styles.class('bench-min-width-zero', {
  minWidth: 0,
});
