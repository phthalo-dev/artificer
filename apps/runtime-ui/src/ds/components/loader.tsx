import { type HTMLAttributes } from 'react';
import { styles, cx } from 'typestyles';
import { color } from '../tokens';

const loaderCls = styles.component('nb-loader', {
  base: {
    display: 'inline-block',
    width: '20px',
    height: '20px',
    border: `3px solid ${color.grayBg}`,
    borderTopColor: color.border,
    borderRadius: '50%',
    animation: 'nb-spin 0.7s linear infinite',
  },
  variants: {
    size: {
      xs: { width: '12px', height: '12px', borderWidth: '2px' },
      sm: { width: '16px', height: '16px', borderWidth: '2px' },
      md: { width: '20px', height: '20px' },
      lg: { width: '28px', height: '28px', borderWidth: '4px' },
    },
  },
  defaultVariants: { size: 'md' },
});

export type LoaderProps = HTMLAttributes<HTMLDivElement> & {
  size?: 'xs' | 'sm' | 'md' | 'lg';
};

export function Loader({ size = 'md', className, ...props }: LoaderProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cx(loaderCls({ size }), className)}
      {...props}
    />
  );
}
