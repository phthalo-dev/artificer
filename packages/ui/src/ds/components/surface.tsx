import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  forwardRef,
} from 'react';
import { cx } from '../styles';
import {
  alert as alertCls,
  alertHeader,
  alertHeaderWithBody,
  divider,
  paper as paperCls,
} from './surface.styles';

export type PaperProps = HTMLAttributes<HTMLDivElement> & {
  withBorder?: boolean;
  radius?: string;
  p?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | string;
  bg?: string;
  maw?: number | string;
  flex?: boolean;
  overflowXAuto?: boolean;
  component?: React.ElementType;
  to?: string;
};

export const Paper = forwardRef<HTMLDivElement, PaperProps>(function Paper(
  {
    withBorder = true,
    p = 'md',
    bg,
    maw,
    flex,
    overflowXAuto,
    component: Tag = 'div',
    className,
    style,
    ...props
  },
  ref,
) {
  const pKey = ['xs', 'sm', 'md', 'lg', 'xl'].includes(p as string)
    ? (p as 'xs' | 'sm' | 'md' | 'lg' | 'xl')
    : 'md';
  const s: CSSProperties = {
    ...(bg ? { background: bg } : {}),
    ...(maw !== undefined
      ? { maxWidth: typeof maw === 'number' ? `${maw}px` : maw }
      : {}),
    ...(p && !['xs', 'sm', 'md', 'lg', 'xl'].includes(p as string)
      ? { padding: p }
      : {}),
    ...style,
  };
  return (
    <Tag
      ref={ref}
      className={cx(
        paperCls({
          p: pKey,
          flex: flex ? 'true' : undefined,
          overflowXAuto: overflowXAuto ? 'true' : undefined,
        }),
        className,
      )}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

export type CardProps = PaperProps & {
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding, p, ...props },
  ref,
) {
  return <Paper ref={ref} p={padding ?? p ?? 'md'} {...props} />;
});

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  color?: 'gray' | 'blue' | 'green' | 'red' | 'orange';
  title?: ReactNode;
  variant?: string;
  icon?: ReactNode;
};

export function Alert({
  color: c = 'blue',
  title,
  icon,
  variant,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div className={cx(alertCls({ color: c }), className)} {...props}>
      {(title || icon) && (
        <div
          className={cx(alertHeader, children ? alertHeaderWithBody : undefined)}
        >
          {icon}
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

export function Divider({
  className,
  ...props
}: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cx(divider, className)} {...props} />;
}
