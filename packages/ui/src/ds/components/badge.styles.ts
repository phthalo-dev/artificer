import { styles } from '../styles';
import { color, font } from '../tokens';

export const badge = styles.component('badge', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: font.familySans,
    fontSize: font.sizeXs,
    fontWeight: font.w600,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    padding: '2px 7px',
    border: `1px solid ${color.border}`,
    borderRadius: '0',
    lineHeight: '1.4',
    whiteSpace: 'nowrap',
  },
  variants: {
    color: {
      gray: {
        background: color.grayLight,
        color: color.gray,
        borderColor: color.gray,
      },
      blue: {
        background: color.blueLight,
        color: color.blue,
        borderColor: color.blue,
      },
      green: {
        background: color.greenLight,
        color: color.green,
        borderColor: color.green,
      },
      red: {
        background: color.redLight,
        color: color.red,
        borderColor: color.red,
      },
      orange: {
        background: color.orangeLight,
        color: color.orange,
        borderColor: color.orange,
      },
      cyan: {
        background: color.cyanLight,
        color: color.cyan,
        borderColor: color.cyan,
      },
      violet: {
        background: color.violetLight,
        color: color.violet,
        borderColor: color.violet,
      },
      indigo: {
        background: color.indigoLight,
        color: color.indigo,
        borderColor: color.indigo,
      },
      teal: {
        background: color.tealLight,
        color: color.teal,
        borderColor: color.teal,
      },
      grape: {
        background: color.grapeLight,
        color: color.grape,
        borderColor: color.grape,
      },
      yellow: {
        background: color.yellowLight,
        color: color.yellow,
        borderColor: color.yellow,
      },
    },
    variant: {
      filled: {
        background: color.border,
        color: color.bg,
        borderColor: color.border,
      },
      light: {},
      outline: { background: 'transparent' },
      dot: { paddingLeft: '14px', position: 'relative' },
    },
    size: {
      xs: { fontSize: '10px', padding: '1px 5px' },
      sm: { fontSize: font.sizeXs },
      md: { fontSize: font.sizeSm },
      lg: { fontSize: font.sizeMd, padding: '3px 10px' },
    },
  },
  defaultVariants: { color: 'gray', variant: 'light', size: 'sm' },
});
