import { type AnchorHTMLAttributes, forwardRef } from 'react';
import { cx } from '../styles';
import { anchor as anchorCls, anchorIcon } from './anchor.styles';

export type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  component?: React.ElementType;
  size?: 'xs' | 'sm' | 'md';
  c?: 'dimmed' | 'inherit';
  download?: string;
  to?: string;
};

export const Anchor = forwardRef<HTMLAnchorElement, AnchorProps>(function Anchor(
  { component: Tag = 'a', size = 'md', c, className, ...props },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={cx(anchorCls({ size, c: c as any }), className)}
      {...props}
    />
  );
});

export { anchorIcon };
