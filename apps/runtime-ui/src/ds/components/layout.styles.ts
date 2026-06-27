import { styles } from '../styles';
import { space } from '../tokens';

export const stack = styles.component('stack', {
  base: { display: 'flex', flexDirection: 'column' },
  variants: {
    gap: {
      xs: { gap: space.xs },
      sm: { gap: space.sm },
      md: { gap: space.md },
      lg: { gap: space.lg },
      xl: { gap: space.xl },
    },
  },
  defaultVariants: { gap: 'md' },
});

export const group = styles.component('group', {
  base: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
  variants: {
    gap: {
      xs: { gap: space.xs },
      sm: { gap: space.sm },
      md: { gap: space.md },
      lg: { gap: space.lg },
      xl: { gap: space.xl },
    },
    alignStretch: {
      true: { alignItems: 'stretch' },
    },
  },
  defaultVariants: { gap: 'sm' },
});

export const simpleGrid = styles.class('simple-grid', {
  display: 'grid',
});

export const scrollArea = styles.class('scroll-area', {
  overflow: 'auto',
});

export const overflowXAuto = styles.class('overflow-x-auto', {
  overflowX: 'auto',
});
