import { style, t } from '../styles/system';

/** Equal-width children in a field row (old `Group grow`). */
export const fill = style('routes-fill', { flex: 1, minWidth: 0 });

export const capitalize = style('routes-capitalize', {
  textTransform: 'capitalize',
});

export const modelCell = style('routes-model-cell', { minWidth: '260px' });

export const modelOptionRow = style('routes-model-option', {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: t.space.sm.var,
  width: '100%',
  whiteSpace: 'nowrap',
});

export const modelGroupLabel = style('routes-model-group', {
  color: t.color.text.secondary.var,
  marginInlineEnd: t.space.xxs.var,
});
