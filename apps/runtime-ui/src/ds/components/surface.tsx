import { type CSSProperties, type HTMLAttributes, type ReactNode, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

// ── Paper ─────────────────────────────────────────────────────────────

const paperCls = styles.component('nb-paper', {
  base: {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `3px 3px 0 0 ${color.border}`,
  },
  variants: {
    p: {
      xs: { padding: space.xs },
      sm: { padding: space.sm },
      md: { padding: space.md },
      lg: { padding: space.lg },
      xl: { padding: space.xl },
    },
  },
  defaultVariants: { p: 'md' },
});

export type PaperProps = HTMLAttributes<HTMLDivElement> & {
  withBorder?: boolean;
  radius?: string;
  p?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | string;
  bg?: string;
  maw?: number | string;
  component?: React.ElementType;
  to?: string;
};

export const Paper = forwardRef<HTMLDivElement, PaperProps>(function Paper(
  { withBorder = true, p = 'md', bg, maw, component: Tag = 'div', className, style, ...props },
  ref,
) {
  const pKey = ['xs', 'sm', 'md', 'lg', 'xl'].includes(p as string) ? p as any : 'md';
  const s: CSSProperties = {
    ...(bg ? { background: bg } : {}),
    ...(maw !== undefined ? { maxWidth: typeof maw === 'number' ? `${maw}px` : maw } : {}),
    ...(p && !['xs', 'sm', 'md', 'lg', 'xl'].includes(p as string) ? { padding: p } : {}),
    ...style,
  };
  return (
    <Tag
      ref={ref}
      className={cx(paperCls({ p: pKey }), className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

// ── Card ──────────────────────────────────────────────────────────────

export type CardProps = PaperProps & {
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding, p, ...props },
  ref,
) {
  return <Paper ref={ref} p={padding ?? p ?? 'md'} {...props} />;
});

// ── Alert ─────────────────────────────────────────────────────────────

const alertCls = styles.component('nb-alert', {
  base: {
    padding: space.md,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    fontSize: font.sizeMd,
    fontFamily: font.familySans,
  },
  variants: {
    color: {
      gray:   { background: color.grayLight,   borderLeftColor: color.gray,   borderLeftWidth: '4px' },
      blue:   { background: color.blueLight,   borderLeftColor: color.blue,   borderLeftWidth: '4px' },
      green:  { background: color.greenLight,  borderLeftColor: color.green,  borderLeftWidth: '4px' },
      red:    { background: color.redLight,    borderLeftColor: color.red,    borderLeftWidth: '4px' },
      orange: { background: color.orangeLight, borderLeftColor: color.orange, borderLeftWidth: '4px' },
    },
  },
  defaultVariants: { color: 'blue' },
});

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  color?: 'gray' | 'blue' | 'green' | 'red' | 'orange';
  title?: ReactNode;
  variant?: string;
  icon?: ReactNode;
};

export function Alert({ color: c = 'blue', title, icon, variant, className, children, ...props }: AlertProps) {
  return (
    <div className={cx(alertCls({ color: c }), className)} {...props}>
      {(title || icon) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: children ? '6px' : 0 }}>
          {icon}
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Divider ───────────────────────────────────────────────────────────

const dividerCls = styles.class('nb-divider', {
  display: 'block',
  height: '2px',
  background: color.border,
  border: 'none',
  margin: `${space.sm} 0`,
});

export function Divider({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cx(dividerCls, className)} {...props} />;
}
