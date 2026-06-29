import { type HTMLAttributes, forwardRef } from 'react';
import { cx } from '../styles';
import { badge as badgeCls } from './badge.styles';

export type BadgeColor =
  | 'gray'
  | 'blue'
  | 'green'
  | 'red'
  | 'orange'
  | 'cyan'
  | 'violet'
  | 'indigo'
  | 'teal'
  | 'grape'
  | 'yellow';

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  color?: BadgeColor;
  variant?: 'filled' | 'light' | 'outline' | 'dot';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  radius?: string;
  ml?: number;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { color: c = 'gray', variant = 'light', size = 'sm', ml, className, style, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cx(badgeCls({ color: c, variant, size }), className)}
      style={{ ...(ml ? { marginLeft: `${ml}px` } : {}), ...style }}
      {...props}
    />
  );
});
