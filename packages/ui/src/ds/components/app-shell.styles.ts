import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const shell = {
  root: styles.class('shell-root', {
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    gridTemplateColumns: '220px 1fr',
    gridTemplateAreas: '"header header" "navbar main"',
    height: '100%',
    minHeight: '100vh',
  }),
  aside: styles.class('shell-aside', {
    gridArea: 'aside',
    borderLeft: `1px solid ${color.border}`,
    background: color.surface,
    overflowY: 'hidden',
    position: 'sticky',
    top: '56px',
    height: 'calc(100vh - 56px)',
    display: 'flex',
    flexDirection: 'column',
  }),
  header: styles.class('shell-header', {
    gridArea: 'header',
    display: 'flex',
    alignItems: 'center',
    borderBottom: `1px solid ${color.border}`,
    background: color.bg,
    position: 'sticky',
    top: '0',
    zIndex: 100,
    height: '56px',
  }),
  navbar: styles.class('shell-navbar', {
    gridArea: 'navbar',
    borderRight: `1px solid ${color.border}`,
    background: color.surface,
    overflowY: 'auto',
    position: 'sticky',
    top: '56px',
    height: 'calc(100vh - 56px)',
  }),
  main: styles.class('shell-main', {
    gridArea: 'main',
    padding: space.md,
    overflowY: 'auto',
  }),
};

export const headerInner = styles.class('shell-header-inner', {
  height: '100%',
});

export const navLink = styles.component('navlink', {
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
    borderRadius: '0',
    cursor: 'pointer',
    background: 'transparent',
    transition: 'background 80ms',
    '&:hover': { background: color.grayLight },
  },
  variants: {
    active: {
      true: {
        background: color.border,
        color: color.bg,
        borderColor: color.border,
        fontWeight: font.w700,
        '&:hover': { background: color.border },
      },
      false: {},
    },
  },
  defaultVariants: { active: 'false' },
});

export const navFooter = styles.class('nav-footer', {
  marginTop: space.md,
  padding: `0 ${space.sm}`,
});
