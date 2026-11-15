import { style, t } from '../styles/system';

export const heroValue = style('bench-hero-value', {
  fontSize: '2.5rem',
  fontWeight: t.fontWeight.bold.var,
  lineHeight: 1,
  margin: 0,
});

export const chartGrid = style('bench-chart-grid', {
  display: 'grid',
  gap: t.space.md.var,
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
});

export const runsTable = style('bench-runs-table', {
  '& table': { minWidth: '760px' },
});

export const suiteCommand = style('bench-suite-command', {
  fontSize: t.fontSize.xs.var,
});

export const patchBlock = style('bench-patch-block', {
  margin: 0,
  overflowX: 'auto',
  fontSize: t.fontSize.xs.var,
  fontFamily: t.fontFamily.mono.var,
  lineHeight: t.lineHeight.relaxed.var,
});

export const patchLine = style('bench-patch-line', {
  whiteSpace: 'pre-wrap',
  color: t.color.text.primary.var,
});

export const patchAdd = style('bench-patch-add', {
  color: t.color.code.addition.var,
  backgroundColor: t.color.code.additionBackground.var,
});

export const patchDel = style('bench-patch-del', {
  color: t.color.code.deletion.var,
  backgroundColor: t.color.code.deletionBackground.var,
});

export const patchHunk = style('bench-patch-hunk', {
  color: t.color.tone.info.foreground.var,
});

export const patchMeta = style('bench-patch-meta', {
  color: t.color.text.secondary.var,
});

export const problemStatement = style('bench-problem-statement', {
  whiteSpace: 'pre-wrap',
  display: '-webkit-box',
  WebkitLineClamp: 20,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const backLink = style('bench-back-link', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: t.space.xxs.var,
  fontSize: t.fontSize.sm.var,
});
