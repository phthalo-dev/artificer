import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const modal = {
  overlay: styles.class('modal-overlay', {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: space.md,
  }),
  dialog: styles.component('modal', {
    base: {
      background: color.bg,
      border: `1px solid ${color.border}`,
      borderRadius: '0',
      width: '100%',
      outline: 'none',
      animation: 'fadein 150ms ease',
    },
    variants: {
      size: {
        xs: { maxWidth: '360px' },
        sm: { maxWidth: '480px' },
        md: { maxWidth: '600px' },
        lg: { maxWidth: '800px' },
        xl: { maxWidth: '1000px' },
      },
    },
    defaultVariants: { size: 'md' },
  }),
  content: styles.class('modal-content', { padding: space.lg }),
  header: styles.class('modal-header', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space.md} ${space.lg}`,
    borderBottom: `1px solid ${color.border}`,
  }),
  title: styles.class('modal-title', {
    fontSize: font.sizeLg,
    fontWeight: font.w700,
  }),
  closeBtn: styles.class('modal-close', {
    background: 'none',
    border: `2px solid ${color.border}`,
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: font.familySans,
    fontSize: font.sizeLg,
    lineHeight: '1',
    '&:hover': { background: color.grayLight },
  }),
};
