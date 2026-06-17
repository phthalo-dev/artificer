import { type AnchorHTMLAttributes, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font } from '../tokens';

const anchorCls = styles.component('nb-anchor', {
  base: {
    color: color.blue,
    textDecoration: 'underline',
    textDecorationThickness: '2px',
    fontFamily: font.familySans,
    cursor: 'pointer',
    '&:hover': { color: color.indigo },
  },
  variants: {
    size: {
      xs: { fontSize: font.sizeXs },
      sm: { fontSize: font.sizeSm },
      md: { fontSize: font.sizeMd },
    },
    c: {
      dimmed:  { color: color.dimmed },
      inherit: { color: 'inherit' },
    },
  },
  defaultVariants: { size: 'md' },
});

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
