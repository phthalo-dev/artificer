import { styles } from '../styles';

export const collapse = styles.component('collapse', {
  base: { overflow: 'hidden', transition: 'max-height 200ms ease, opacity 200ms ease' },
  variants: {
    open: {
      true: { maxHeight: '10000px', opacity: '1' },
      false: { maxHeight: '0px', opacity: '0' },
    },
  },
  defaultVariants: { open: 'false' },
});
