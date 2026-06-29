import { styles } from './styles';
import { color, font, space } from './tokens';

export const toastContainer = styles.class('toast-container', {
  position: 'fixed',
  top: '16px',
  right: '16px',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  gap: space.sm,
  maxWidth: '380px',
});

export const toast = styles.component('toast', {
  base: {
    background: color.bg,
    border: `1px solid ${color.border}`,
    borderRadius: '0',
    padding: space.md,
    fontFamily: font.familySans,
    fontSize: font.sizeSm,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    animation: 'fadein 150ms ease',
    minWidth: '280px',
  },
  variants: {
    level: {
      success: { borderLeftColor: color.green, borderLeftWidth: '4px' },
      error: { borderLeftColor: color.red, borderLeftWidth: '4px' },
      warning: { borderLeftColor: color.orange, borderLeftWidth: '4px' },
      info: { borderLeftColor: color.blue, borderLeftWidth: '4px' },
      default: {},
    },
  },
  defaultVariants: { level: 'default' },
});

export const toastRow = styles.class('toast-row', {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '8px',
});

export const toastTitle = styles.class('toast-title', {
  fontWeight: 700,
  marginBottom: '2px',
});

export const toastDismiss = styles.class('toast-dismiss', {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '16px',
  lineHeight: 1,
  padding: '0 2px',
  color: color.dimmed,
});
