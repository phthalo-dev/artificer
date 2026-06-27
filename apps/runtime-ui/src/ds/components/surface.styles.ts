import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const paper = styles.component('paper', {
  base: {
    background: color.bg,
    border: `1px solid ${color.border}`,
    borderRadius: '0',
  },
  variants: {
    p: {
      xs: { padding: space.xs },
      sm: { padding: space.sm },
      md: { padding: space.md },
      lg: { padding: space.lg },
      xl: { padding: space.xl },
    },
    flex: {
      true: { flex: 1, minWidth: '120px' },
    },
    overflowXAuto: {
      true: { overflowX: 'auto' },
    },
  },
  defaultVariants: { p: 'md' },
});

export const alert = styles.component('alert', {
  base: {
    padding: space.md,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    fontSize: font.sizeMd,
    fontFamily: font.familySans,
  },
  variants: {
    color: {
      gray: {
        background: color.grayLight,
        borderLeftColor: color.gray,
        borderLeftWidth: '4px',
      },
      blue: {
        background: color.blueLight,
        borderLeftColor: color.blue,
        borderLeftWidth: '4px',
      },
      green: {
        background: color.greenLight,
        borderLeftColor: color.green,
        borderLeftWidth: '4px',
      },
      red: {
        background: color.redLight,
        borderLeftColor: color.red,
        borderLeftWidth: '4px',
      },
      orange: {
        background: color.orangeLight,
        borderLeftColor: color.orange,
        borderLeftWidth: '4px',
      },
    },
  },
  defaultVariants: { color: 'blue' },
});

export const alertHeader = styles.class('alert-header', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontWeight: 700,
});

export const alertHeaderWithBody = styles.class('alert-header-body', {
  marginBottom: '6px',
});

export const divider = styles.class('divider', {
  display: 'block',
  height: '1px',
  background: color.border,
  border: 'none',
  margin: `${space.sm} 0`,
});
