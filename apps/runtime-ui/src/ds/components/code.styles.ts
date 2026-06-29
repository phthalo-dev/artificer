import { styles } from '../styles';
import { color, font } from '../tokens';

export const codeInline = styles.class('code-inline', {
  fontFamily: font.familyMono,
  fontSize: '0.88em',
  background: color.grayLight,
  border: `1px solid ${color.grayBg}`,
  borderRadius: '0',
  padding: '1px 5px',
  color: color.text,
});

export const codeBlock = styles.class('code-block', {
  fontFamily: font.familyMono,
  fontSize: font.sizeSm,
  background: color.grayLight,
  border: `1px solid ${color.border}`,
  borderRadius: '0',
  padding: '12px 16px',
  overflowX: 'auto',
  display: 'block',
  whiteSpace: 'pre-wrap',
  color: color.text,
});

export const code = styles.component('code', {
  base: {
    fontFamily: font.familyMono,
    color: color.text,
  },
  variants: {
    block: {
      true: {
        fontSize: font.sizeSm,
        background: color.grayLight,
        border: `1px solid ${color.border}`,
        borderRadius: '0',
        padding: '12px 16px',
        overflowX: 'auto',
        display: 'block',
        whiteSpace: 'pre-wrap',
      },
      false: {
        fontSize: '0.88em',
        background: color.grayLight,
        border: `1px solid ${color.grayBg}`,
        borderRadius: '0',
        padding: '1px 5px',
      },
    },
    size: {
      xs: { fontSize: font.sizeXs },
      sm: { fontSize: font.sizeSm },
    },
    scroll: {
      true: { maxHeight: '280px', overflow: 'auto' },
    },
  },
  defaultVariants: { block: 'false' },
});
