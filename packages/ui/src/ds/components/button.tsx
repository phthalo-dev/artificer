import { type ReactNode, forwardRef } from 'react';
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from 'react-aria-components';
import { cx } from '../styles';
import { button, buttonSpinner, unstyledButton } from './button.styles';

export type ButtonProps = Omit<AriaButtonProps, 'className' | 'children'> & {
  variant?: 'filled' | 'light' | 'default' | 'subtle' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  leftSection?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'default',
      size = 'md',
      loading,
      leftSection,
      children,
      className,
      isDisabled,
      ...props
    },
    ref,
  ) {
    return (
      <AriaButton
        ref={ref}
        className={cx(button({ variant, size }), className)}
        isDisabled={isDisabled || loading}
        {...props}
      >
        {loading ? <span className={buttonSpinner} /> : leftSection}
        {children}
      </AriaButton>
    );
  },
);

export type UnstyledButtonProps = Omit<
  AriaButtonProps,
  'className' | 'children'
> & {
  className?: string;
  children?: ReactNode;
  style?: React.CSSProperties;
};

export function UnstyledButton({ className, ...props }: UnstyledButtonProps) {
  return <AriaButton className={cx(unstyledButton, className)} {...props} />;
}
