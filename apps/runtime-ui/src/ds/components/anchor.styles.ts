import { styles } from '../styles';
import { color, font } from '../tokens';

export const anchor = styles.component('anchor', {
  base: {
    color: color.blue,
    textDecoration: 'underline',
    textDecorationThickness: '2px',
    fontFamily: font.familySans,
    cursor: 'pointer',
    '&:hover': { color: color.indigo },
  },
  variants: {
    size: {
      xs: { fontSize: font.sizeXs },
      sm: { fontSize: font.sizeSm },
      md: { fontSize: font.sizeMd },
    },
    c: {
      dimmed: { color: color.dimmed },
      inherit: { color: 'inherit' },
    },
  },
  defaultVariants: { size: 'md' },
});

export const anchorIcon = styles.class('anchor-icon', {
  verticalAlign: '-2px',
});
