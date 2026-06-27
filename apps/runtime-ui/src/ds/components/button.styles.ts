import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const button = styles.component('button', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    fontFamily: font.familySans,
    fontWeight: font.w700,
    cursor: 'pointer',
    border: `1px solid ${color.border}`,
    borderRadius: '0',
    background: color.bg,
    color: color.text,
    transition: 'transform 80ms, box-shadow 80ms',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    '&[data-pressed]': {
      transform: 'translate(2px, 2px)',
    },
    '&[data-hovered]': { background: color.grayLight },
    '&[data-disabled]': {
      opacity: 0.4,
      cursor: 'not-allowed',
      pointerEvents: 'none',
    },
    '&[data-focused]': {
      outline: `2px solid ${color.border}`,
      outlineOffset: '2px',
    },
  },
  variants: {
    variant: {
      filled: {
        background: color.border,
        color: color.bg,
        '&[data-hovered]': { background: color.grayBg },
      },
      light: {
        background: color.grayLight,
        boxShadow: 'none',
        '&[data-hovered]': { background: color.grayBg },
      },
      default: {},
      subtle: {
        border: '2px solid transparent',
        boxShadow: 'none',
        '&[data-hovered]': {
          background: color.grayLight,
          borderColor: color.grayBg,
        },
      },
      outline: { background: 'transparent' },
    },
    size: {
      xs: { padding: '3px 8px', fontSize: font.sizeXs },
      sm: { padding: '5px 10px', fontSize: font.sizeSm },
      md: { padding: '7px 14px', fontSize: font.sizeMd },
      lg: { padding: '9px 18px', fontSize: font.sizeLg },
    },
  },
  defaultVariants: { variant: 'default', size: 'md' },
});

export const unstyledButton = styles.class('unstyled-button', {
  background: 'none',
  border: 'none',
  padding: '0',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  '&[data-focused]': {
    outline: `2px solid ${color.border}`,
    outlineOffset: '2px',
  },
});

export const buttonSpinner = styles.class('button-spinner', {
  animation: 'spin 0.7s linear infinite',
  display: 'inline-block',
  width: '14px',
  height: '14px',
  border: '2px solid currentColor',
  borderTopColor: 'transparent',
  borderRadius: '50%',
});
