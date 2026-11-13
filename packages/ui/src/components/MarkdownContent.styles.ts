import { style, t } from '../styles/system';

/**
 * Compact prose for chat bubbles and panels. (Var UI's `proseContent` recipe is
 * tuned for long-form docs — display headings, large rhythm — so it's too loud here.)
 */
export const prose = style('markdown-content', {
  fontSize: t.fontSize.sm.var,
  lineHeight: 1.6,
  color: 'inherit',
  wordBreak: 'break-word',
  '& > *:first-child': { marginTop: 0 },
  '& > *:last-child': { marginBottom: 0 },
  '& p': { margin: `${t.space.xs.var} 0` },
  '& h1': {
    fontSize: t.fontSize.xl.var,
    fontWeight: t.fontWeight.bold.var,
    margin: `${t.space.md.var} 0 ${t.space.xs.var}`,
  },
  '& h2': {
    fontSize: t.fontSize.lg.var,
    fontWeight: t.fontWeight.bold.var,
    margin: `${t.space.md.var} 0 ${t.space.xs.var}`,
  },
  '& h3': {
    fontSize: t.fontSize.md.var,
    fontWeight: t.fontWeight.semibold.var,
    margin: `${t.space.xs.var} 0 ${t.space.xxs.var}`,
  },
  '& h4, & h5, & h6': {
    fontSize: t.fontSize.sm.var,
    fontWeight: t.fontWeight.semibold.var,
    margin: `${t.space.xs.var} 0 ${t.space.xxs.var}`,
  },
  '& ul, & ol': {
    margin: `${t.space.xs.var} 0`,
    paddingLeft: t.space.lg.var,
  },
  '& li': { margin: `${t.space.xxs.var} 0` },
  '& li > p': { margin: `${t.space.xxs.var} 0` },
  '& blockquote': {
    margin: `${t.space.xs.var} 0`,
    paddingLeft: t.space.md.var,
    borderLeft: `3px solid ${t.color.border.default.var}`,
    color: t.color.text.secondary.var,
  },
  '& hr': {
    border: 'none',
    borderTop: `1px solid ${t.color.border.default.var}`,
    margin: `${t.space.md.var} 0`,
  },
  '& table': {
    width: '100%',
    borderCollapse: 'collapse',
    margin: `${t.space.xs.var} 0`,
    fontSize: t.fontSize.sm.var,
  },
  '& th, & td': {
    border: `1px solid ${t.color.border.default.var}`,
    padding: `${t.space.xxs.var} ${t.space.xs.var}`,
    textAlign: 'left',
  },
  '& th': {
    fontWeight: t.fontWeight.semibold.var,
    background: t.color.background.muted.var,
  },
  '& img': { maxWidth: '100%', height: 'auto' },
});

export const preWrapper = style('markdown-pre-wrapper', {
  margin: `${t.space.xs.var} 0`,
});
