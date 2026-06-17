import { type ReactNode } from 'react';
import { styles } from 'typestyles';

const collapseCls = styles.component('nb-collapse', {
  base: { overflow: 'hidden', transition: 'max-height 200ms ease, opacity 200ms ease' },
  variants: {
    open: {
      true:  { maxHeight: '10000px', opacity: '1' },
      false: { maxHeight: '0px',     opacity: '0' },
    },
  },
  defaultVariants: { open: 'false' },
});

export type CollapseProps = {
  in: boolean;
  children: ReactNode;
};

export function Collapse({ in: open, children }: CollapseProps) {
  return (
    <div className={collapseCls({ open: open ? 'true' : 'false' })}>
      {children}
    </div>
  );
}
