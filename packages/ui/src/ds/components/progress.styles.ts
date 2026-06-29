import { styles } from '../styles';
import { color } from '../tokens';

export const progressTrack = styles.component('progress-track', {
  base: {
    width: '100%',
    background: color.grayLight,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    overflow: 'hidden',
  },
  variants: {
    size: {
      xs: { height: '6px' },
      sm: { height: '8px' },
      md: { height: '12px' },
      lg: { height: '16px' },
    },
  },
  defaultVariants: { size: 'md' },
});

export const progressBar = styles.class('progress-bar', {
  height: '100%',
  background: color.blue,
  transition: 'width 300ms ease',
});
