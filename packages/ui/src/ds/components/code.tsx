import { type HTMLAttributes, forwardRef } from 'react';
import { cx } from '../styles';
import { code as codeCls } from './code.styles';

export type CodeProps = HTMLAttributes<HTMLElement> & {
  block?: boolean;
  size?: 'xs' | 'sm';
  scroll?: boolean;
  c?: string;
};

export const Code = forwardRef<HTMLElement, CodeProps>(function Code(
  { block, size, scroll, c, className, style, ...props },
  ref,
) {
  return (
    <code
      ref={ref}
      className={cx(
        codeCls({
          block: block ? 'true' : 'false',
          size,
          scroll: scroll ? 'true' : undefined,
        }),
        className,
      )}
      style={{ ...(c ? { color: c } : {}), ...style }}
      {...props}
    />
  );
});
