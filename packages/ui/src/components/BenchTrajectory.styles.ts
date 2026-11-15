import { style, t } from '../styles/system';

export const stepTrigger = style('bench-step-trigger', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: t.space.sm.var,
  width: '100%',
  minWidth: 0,
});

export const toolTrigger = style('bench-tool-trigger', {
  display: 'flex',
  alignItems: 'center',
  gap: t.space.xs.var,
  width: '100%',
  minWidth: 0,
  fontWeight: t.fontWeight.normal.var,
});

/** Indent tool detail under the chevron + index columns. */
export const toolDetail = style('bench-tool-detail', {
  paddingInlineStart: '2.25rem',
});

export const toolOutput = style('bench-tool-output', {
  maxHeight: '24rem',
  overflow: 'auto',
});

export const stepIndex = style('bench-step-index', {
  minWidth: '1.75rem',
  textAlign: 'right',
  flexShrink: 0,
});

export const toolIndex = style('bench-tool-index', {
  minWidth: '1.125rem',
  textAlign: 'right',
  flexShrink: 0,
});

export const minWidthZero = style('bench-min-width-zero', {
  minWidth: 0,
});

export const roleDot = style('bench-role-dot', {
  display: 'inline-block',
  width: '0.5rem',
  height: '0.5rem',
  borderRadius: t.radius.full.var,
  marginInlineEnd: t.space.xxs.var,
  flexShrink: 0,
});

/** Inline flex row usable inside a `<button>` trigger (Stack renders a div). */
export const triggerRow = style('bench-trigger-row', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: t.space.xs.var,
});

export const triggerMeta = style('bench-trigger-meta', {
  gap: t.space.md.var,
  flexShrink: 0,
});
