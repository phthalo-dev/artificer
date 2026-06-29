import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const select = {
  root: styles.class('select-root', {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
  }),
  label: styles.class('select-label', {
    fontSize: font.sizeSm,
    fontWeight: font.w600,
    display: 'block',
  }),
  trigger: styles.class('select-trigger', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    padding: `${space.xs} ${space.sm}`,
    background: color.bg,
    border: `1px solid ${color.border}`,
    borderRadius: '0',
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    cursor: 'pointer',
    minWidth: '200px',
    width: '100%',
    '&[data-hovered]': { background: color.grayLight },
    '&[data-focused]': {
      outline: `2px solid ${color.border}`,
      outlineOffset: '2px',
    },
  }),
  popover: styles.class('select-popover', {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    animation: 'fadein 120ms ease',
    minWidth: 'var(--trigger-width)',
    zIndex: 1000,
    maxHeight: '300px',
    overflow: 'auto',
  }),
  item: styles.class('select-item', {
    padding: `${space.xs} ${space.sm}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    cursor: 'pointer',
    outline: 'none',
    '&[data-focused]': { background: color.grayLight },
    '&[data-selected]': { background: color.border, color: color.bg },
  }),
  section: styles.class('select-section', {
    padding: `${space.xs} ${space.sm}`,
    fontSize: font.sizeXs,
    fontWeight: font.w700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: color.dimmed,
    borderTop: `1px solid ${color.grayBg}`,
  }),
};
