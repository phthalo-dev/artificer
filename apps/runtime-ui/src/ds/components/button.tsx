import { type ReactNode, forwardRef } from 'react';
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from 'react-aria-components';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const btnCls = styles.component('nb-button', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    fontFamily: font.familySans,
    fontWeight: font.w700,
    cursor: 'pointer',
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    background: color.bg,
    color: color.text,
    boxShadow: `3px 3px 0 0 ${color.border}`,
    transition: 'transform 80ms, box-shadow 80ms',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    '&[data-pressed]':  { transform: 'translate(2px, 2px)', boxShadow: `1px 1px 0 0 ${color.border}` },
    '&[data-hovered]':  { background: color.grayLight },
    '&[data-disabled]': { opacity: 0.4, cursor: 'not-allowed', boxShadow: 'none', pointerEvents: 'none' },
    '&[data-focused]':  { outline: `2px solid ${color.border}`, outlineOffset: '2px' },
  },
  variants: {
    variant: {
      filled:  {
        background: color.border,
        color: color.bg,
        '&[data-hovered]': { background: '#222' },
      },
      light:   { background: color.grayLight, boxShadow: 'none', '&[data-hovered]': { background: color.grayBg } },
      default: {},
      subtle:  { border: '2px solid transparent', boxShadow: 'none', '&[data-hovered]': { background: color.grayLight, borderColor: color.grayBg } },
      outline: { background: 'transparent' },
    },
    size: {
      xs: { padding: '3px 8px',  fontSize: font.sizeXs },
      sm: { padding: '5px 10px', fontSize: font.sizeSm },
      md: { padding: '7px 14px', fontSize: font.sizeMd },
      lg: { padding: '9px 18px', fontSize: font.sizeLg },
    },
  },
  defaultVariants: { variant: 'default', size: 'md' },
});

export type ButtonProps = Omit<AriaButtonProps, 'className' | 'children'> & {
  variant?: 'filled' | 'light' | 'default' | 'subtle' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  leftSection?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', loading, leftSection, children, className, isDisabled, ...props },
  ref,
) {
  return (
    <AriaButton
      ref={ref}
      className={cx(btnCls({ variant, size }), className)}
      isDisabled={isDisabled || loading}
      {...props}
    >
      {loading ? <span style={{ animation: 'nb-spin 0.7s linear infinite', display: 'inline-block', width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} /> : leftSection}
      {children}
    </AriaButton>
  );
});

// ── UnstyledButton ────────────────────────────────────────────────────

const unstyledCls = styles.class('nb-unstyled-button', {
  background: 'none',
  border: 'none',
  padding: '0',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  '&[data-focused]': { outline: `2px solid ${color.border}`, outlineOffset: '2px' },
});

export type UnstyledButtonProps = Omit<AriaButtonProps, 'className' | 'children'> & {
  className?: string;
  children?: ReactNode;
  style?: React.CSSProperties;
};

export function UnstyledButton({ className, ...props }: UnstyledButtonProps) {
  return <AriaButton className={cx(unstyledCls, className)} {...props} />;
}
