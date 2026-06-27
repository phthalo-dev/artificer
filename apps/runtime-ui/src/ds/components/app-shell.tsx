import { type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../styles';
import { space } from '../tokens';
import {
  headerInner,
  navFooter,
  navLink as navLinkCls,
  shell,
} from './app-shell.styles';

type ShellHeaderProps = HTMLAttributes<HTMLDivElement> & {
  px?: string;
  h?: number;
};
function ShellHeader({
  px = space.md,
  h,
  children,
  className,
  style,
  ...props
}: ShellHeaderProps) {
  return (
    <header
      className={cx(shell.header, className)}
      style={{
        height: h ? `${h}px` : '56px',
        padding: `0 ${px}`,
        ...style,
      }}
      {...props}
    >
      {children}
    </header>
  );
}

type ShellNavbarProps = HTMLAttributes<HTMLElement> & {
  p?: string;
  width?: { width: number; breakpoint: string };
};

function ShellNavbar({
  p = space.sm,
  width,
  children,
  className,
  style,
  ...props
}: ShellNavbarProps) {
  return (
    <nav
      className={cx(shell.navbar, className)}
      style={{
        width: width?.width ? `${width.width}px` : '220px',
        padding: p,
        ...style,
      }}
      {...props}
    >
      {children}
    </nav>
  );
}

type ShellMainProps = HTMLAttributes<HTMLElement>;
function ShellMain({ children, className, style, ...props }: ShellMainProps) {
  return (
    <main className={cx(shell.main, className)} style={style} {...props}>
      {children}
    </main>
  );
}

type ShellAsideProps = HTMLAttributes<HTMLElement> & { p?: string };
function ShellAside({
  p = space.sm,
  children,
  className,
  style,
  ...props
}: ShellAsideProps) {
  return (
    <aside
      className={cx(shell.aside, className)}
      style={{ padding: p, ...style }}
      {...props}
    >
      {children}
    </aside>
  );
}

export type AppShellProps = HTMLAttributes<HTMLDivElement> & {
  header?: { height: number };
  navbar?: { width: number; breakpoint: string };
  aside?: { width: number; open: boolean };
  padding?: string;
  children: ReactNode;
};

function AppShellRoot({
  header,
  navbar,
  aside,
  padding,
  children,
  className,
  style,
  ...props
}: AppShellProps) {
  const gridCols = aside?.open ? `220px 1fr ${aside.width}px` : '220px 1fr';
  const gridAreas = aside?.open
    ? '"header header header" "navbar main aside"'
    : '"header header" "navbar main"';
  return (
    <div
      className={cx(shell.root, className)}
      style={{
        gridTemplateColumns: gridCols,
        gridTemplateAreas: gridAreas,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export const AppShell = Object.assign(AppShellRoot, {
  Header: ShellHeader,
  Navbar: ShellNavbar,
  Main: ShellMain,
  Aside: ShellAside,
});

export { headerInner, navFooter };

export type NavLinkProps = HTMLAttributes<HTMLAnchorElement> & {
  component?: React.ElementType;
  to?: string;
  label?: ReactNode;
  leftSection?: ReactNode;
  active?: boolean;
  href?: string;
};

export function NavLink({
  component: Tag = 'a',
  to,
  label,
  leftSection,
  active,
  className,
  ...props
}: NavLinkProps) {
  return (
    <Tag
      to={to}
      href={to}
      className={cx(
        navLinkCls({ active: active ? 'true' : 'false' }),
        className,
      )}
      {...props}
    >
      {leftSection}
      {label}
    </Tag>
  );
}
