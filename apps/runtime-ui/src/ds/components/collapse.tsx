import { type ReactNode } from 'react';
import { collapse as collapseCls } from './collapse.styles';

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
