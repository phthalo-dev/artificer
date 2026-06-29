import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const tableRoot = styles.component('table-root', {
  base: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: font.familySans,
    fontSize: font.sizeSm,
  },
  variants: {
    withBorder: {
      true: {
        border: `1px solid ${color.border}`,
      },
    },
    striped: {
      true: { '& tbody tr:nth-child(even)': { background: color.surface } },
    },
    hover: {
      true: { '& tbody tr:hover': { background: color.grayLight } },
    },
  },
});

export const tableThead = styles.class('table-thead', {
  borderBottom: `2px solid ${color.border}`,
});

export const tableTh = styles.class('table-th', {
  padding: `${space.xs} ${space.sm}`,
  textAlign: 'left',
  fontWeight: font.w700,
  fontSize: font.sizeXs,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: color.muted,
  whiteSpace: 'nowrap',
});

export const tableTd = styles.class('table-td', {
  padding: `${space.xs} ${space.sm}`,
  borderBottom: `1px solid ${color.grayBg}`,
  verticalAlign: 'top',
});

export const tableScroll = styles.class('table-scroll', {
  overflowX: 'auto',
});
