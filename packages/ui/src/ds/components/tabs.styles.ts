import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const tabs = {
  root: styles.class('tabs-root', { width: '100%' }),
  list: styles.class('tabs-list', {
    display: 'flex',
    borderBottom: `1px solid ${color.border}`,
    gap: '0',
  }),
  tab: styles.class('tabs-tab', {
    padding: `${space.sm} ${space.md}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    fontWeight: font.w600,
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    outline: 'none',
    color: color.muted,
    transition: 'color 100ms, border-color 100ms',
    '&[data-selected]': { color: color.text, borderBottomColor: color.border },
    '&[data-hovered]': { color: color.text, borderBottomColor: color.border },
    '&[data-focused]': {
      outline: `2px solid ${color.border}`,
      outlineOffset: '-2px',
    },
  }),
  panel: styles.class('tabs-panel', { paddingTop: space.md, outline: 'none' }),
};
