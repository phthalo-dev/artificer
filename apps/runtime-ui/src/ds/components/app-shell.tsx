import { type HTMLAttributes, type ReactNode } from 'react';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const shellCls = {
  root: styles.class('nb-shell-root', {
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    gridTemplateColumns: '220px 1fr',
    gridTemplateAreas: '"header header" "navbar main"',
    height: '100%',
    minHeight: '100vh',
  }),
  aside: styles.class('nb-shell-aside', {
    gridArea: 'aside',
    borderLeft: `2px solid ${color.border}`,
    background: color.surface,
    overflowY: 'hidden',
    position: 'sticky',
    top: '56px',
    height: 'calc(100vh - 56px)',
    display: 'flex',
    flexDirection: 'column',
  }),
  header: styles.class('nb-shell-header', {
    gridArea: 'header',
    display: 'flex',
    alignItems: 'center',
    borderBottom: `2px solid ${color.border}`,
    background: color.bg,
    boxShadow: `0 2px 0 0 ${color.border}`,
    position: 'sticky',
    top: '0',
    zIndex: 100,
    height: '56px',
  }),
  navbar: styles.class('nb-shell-navbar', {
    gridArea: 'navbar',
    borderRight: `2px solid ${color.border}`,
    background: color.surface,
    overflowY: 'auto',
    position: 'sticky',
    top: '56px',
    height: 'calc(100vh - 56px)',
  }),
  main: styles.class('nb-shell-main', {
    gridArea: 'main',
    padding: space.md,
    overflowY: 'auto',
  }),
};

type ShellHeaderProps = HTMLAttributes<HTMLDivElement> & { px?: string; h?: number };
function ShellHeader({ px = space.md, h, children, className, style, ...props }: ShellHeaderProps) {
  return (
    <header
      className={cx(shellCls.header, className)}
      style={{ height: h ? `${h}px` : '56px', padding: `0 ${px}`, ...style }}
      {...props}
    >
      {children}
    </header>
  );
}

type ShellNavbarProps = HTMLAttributes<HTMLElement> & { p?: string; width?: { width: number; breakpoint: string } };
function ShellNavbar({ p = space.sm, width, children, className, style, ...props }: ShellNavbarProps) {
  return (
    <nav
      className={cx(shellCls.navbar, className)}
      style={{ width: width?.width ? `${width.width}px` : '220px', padding: p, ...style }}
      {...props}
    >
      {children}
    </nav>
  );
}

type ShellMainProps = HTMLAttributes<HTMLElement>;
function ShellMain({ children, className, style, ...props }: ShellMainProps) {
  return (
    <main className={cx(shellCls.main, className)} style={style} {...props}>
      {children}
    </main>
  );
}

type ShellAsideProps = HTMLAttributes<HTMLElement> & { p?: string };
function ShellAside({ p = space.sm, children, className, style, ...props }: ShellAsideProps) {
  return (
    <aside
      className={cx(shellCls.aside, className)}
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

function AppShellRoot({ header, navbar, aside, padding, children, className, style, ...props }: AppShellProps) {
  const gridCols = aside?.open ? `220px 1fr ${aside.width}px` : '220px 1fr';
  const gridAreas = aside?.open
    ? '"header header header" "navbar main aside"'
    : '"header header" "navbar main"';
  return (
    <div
      className={cx(shellCls.root, className)}
      style={{ gridTemplateColumns: gridCols, gridTemplateAreas: gridAreas, ...style }}
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

// ── NavLink ────────────────────────────────────────────────────────────

const navLinkCls = styles.component('nb-navlink', {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    padding: `${space.xs} ${space.sm}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    fontWeight: font.w500,
    color: color.text,
    textDecoration: 'none',
    border: '2px solid transparent',
    borderRadius: '0',
    cursor: 'pointer',
    background: 'transparent',
    transition: 'background 80ms',
    '&:hover': { background: color.grayLight, borderColor: color.grayBg },
  },
  variants: {
    active: {
      true: {
        background: color.border,
        color: color.bg,
        borderColor: color.border,
        fontWeight: font.w700,
        '&:hover': { background: color.grayBg },
      },
      false: {},
    },
  },
  defaultVariants: { active: 'false' },
});

export type NavLinkProps = HTMLAttributes<HTMLAnchorElement> & {
  component?: React.ElementType;
  to?: string;
  label?: ReactNode;
  leftSection?: ReactNode;
  active?: boolean;
  href?: string;
};

export function NavLink({ component: Tag = 'a', to, label, leftSection, active, className, ...props }: NavLinkProps) {
  return (
    <Tag
      to={to}
      href={to}
      className={cx(navLinkCls({ active: active ? 'true' : 'false' }), className)}
      {...props}
    >
      {leftSection}
      {label}
    </Tag>
  );
}
