import { type HTMLAttributes } from 'react';
import { cx } from '../styles';
import { loader as loaderCls } from './loader.styles';

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
