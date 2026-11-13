import { style, t } from '../styles/system';

export const callNode = style('call-tree-node', {
  marginBottom: '6px',
});

export const toggleButton = style('call-tree-toggle', {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '16px',
  height: '16px',
  padding: 0,
  border: 0,
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  borderRadius: t.radius.sm.var,
  flexShrink: 0,
  '&:focus-visible': {
    outline: `2px solid ${t.color.border.focus.var}`,
    outlineOffset: '1px',
  },
});

export const toggleSpacer = style('call-tree-toggle-spacer', {
  width: '16px',
  flexShrink: 0,
});

export const rowMain = style('call-tree-row-main', { minWidth: 0 });

/** Align task/error lines with the role label (toggle width + gap). */
export const detailLine = style('call-tree-detail', {
  marginLeft: `calc(16px + ${t.space.xs.var})`,
  marginTop: t.space.xxs.var,
});

export const modelCode = style('call-tree-model', {
  fontSize: t.fontSize.xs.var,
});
