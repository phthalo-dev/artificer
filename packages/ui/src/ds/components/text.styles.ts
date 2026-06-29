import { styles } from '../styles';
import { color, font } from '../tokens';

export const text = styles.component('text', {
  base: {
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    color: color.text,
    lineHeight: '1.5',
  },
  variants: {
    size: {
      xs: { fontSize: font.sizeXs },
      sm: { fontSize: font.sizeSm },
      md: { fontSize: font.sizeMd },
      lg: { fontSize: font.sizeLg },
      xl: { fontSize: font.sizeXl },
    },
    c: {
      dimmed: { color: color.dimmed },
      muted: { color: color.muted },
      red: { color: color.red },
      green: { color: color.green },
      blue: { color: color.blue },
      orange: { color: color.orange },
      cyan: { color: color.cyan },
      violet: { color: color.violet },
      grape: { color: color.grape },
      teal: { color: color.teal },
      indigo: { color: color.indigo },
      gray: { color: color.gray },
      inherit: { color: 'inherit' },
    },
    upper: {
      true: { textTransform: 'uppercase', letterSpacing: '0.05em' },
    },
    mono: {
      true: { fontFamily: font.familyMono },
    },
    preWrap: {
      true: { whiteSpace: 'pre-wrap' },
    },
  },
  defaultVariants: { size: 'md' },
});

export const title = styles.component('title', {
  base: {
    fontFamily: font.familySans,
    fontWeight: font.w700,
    color: color.text,
    lineHeight: '1.2',
  },
  variants: {
    order: {
      '1': { fontSize: font.size4xl },
      '2': { fontSize: font.size3xl },
      '3': { fontSize: font.size2xl },
      '4': { fontSize: font.sizeXl },
      '5': { fontSize: font.sizeLg, fontWeight: font.w600 },
      '6': { fontSize: font.sizeMd, fontWeight: font.w600 },
    },
  },
  defaultVariants: { order: '3' },
});
