import { styles } from '../ds/styles';
import { color, font, space } from '../ds/tokens';

export const prose = styles.class('markdown-content', {
  fontSize: font.sizeSm,
  lineHeight: 1.6,
  color: color.text,
  wordBreak: 'break-word',
  '& > *:first-child': { marginTop: 0 },
  '& > *:last-child': { marginBottom: 0 },
  '& p': { margin: `${space.sm} 0` },
  '& h1': {
    fontSize: font.sizeXl,
    fontWeight: font.w700,
    margin: `${space.md} 0 ${space.sm}`,
  },
  '& h2': {
    fontSize: font.sizeLg,
    fontWeight: font.w700,
    margin: `${space.md} 0 ${space.sm}`,
  },
  '& h3': {
    fontSize: font.sizeMd,
    fontWeight: font.w600,
    margin: `${space.sm} 0 ${space.xs}`,
  },
  '& h4, & h5, & h6': {
    fontSize: font.sizeSm,
    fontWeight: font.w600,
    margin: `${space.sm} 0 ${space.xs}`,
  },
  '& ul, & ol': {
    margin: `${space.sm} 0`,
    paddingLeft: space.lg,
  },
  '& li': { margin: `${space.xs} 0` },
  '& li > p': { margin: `${space.xs} 0` },
  '& blockquote': {
    margin: `${space.sm} 0`,
    paddingLeft: space.md,
    borderLeft: `3px solid ${color.border}`,
    color: color.muted,
  },
  '& hr': {
    border: 'none',
    borderTop: `1px solid ${color.border}`,
    margin: `${space.md} 0`,
  },
  '& table': {
    width: '100%',
    borderCollapse: 'collapse',
    margin: `${space.sm} 0`,
    fontSize: font.sizeSm,
  },
  '& th, & td': {
    border: `1px solid ${color.border}`,
    padding: `${space.xs} ${space.sm}`,
    textAlign: 'left',
  },
  '& th': {
    fontWeight: font.w600,
    background: color.grayLight,
  },
  '& img': { maxWidth: '100%', height: 'auto' },
});

export const preWrapper = styles.class('markdown-pre-wrapper', {
  margin: `${space.sm} 0`,
});
