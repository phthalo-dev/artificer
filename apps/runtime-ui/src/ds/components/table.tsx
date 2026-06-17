import {
  type CSSProperties,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const rootCls = styles.component('nb-table-root', {
  base: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: font.familySans,
    fontSize: font.sizeSm,
  },
  variants: {
    withBorder: {
      true: { border: `2px solid ${color.border}`, boxShadow: `3px 3px 0 0 ${color.border}` },
    },
    striped: {
      true: { '& tbody tr:nth-child(even)': { background: color.surface } },
    },
    hover: {
      true: { '& tbody tr:hover': { background: color.grayLight } },
    },
  },
});

const theadCls = styles.class('nb-table-thead', {
  borderBottom: `2px solid ${color.border}`,
});

const thCls = styles.class('nb-table-th', {
  padding: `${space.xs} ${space.sm}`,
  textAlign: 'left',
  fontWeight: font.w700,
  fontSize: font.sizeXs,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: color.muted,
  whiteSpace: 'nowrap',
});

const tdCls = styles.class('nb-table-td', {
  padding: `${space.xs} ${space.sm}`,
  borderBottom: `1px solid ${color.grayBg}`,
  verticalAlign: 'top',
});

const scrollCls = styles.class('nb-table-scroll', { overflowX: 'auto' });

export type TableRootProps = HTMLAttributes<HTMLTableElement> & {
  striped?: boolean;
  highlightOnHover?: boolean;
  withTableBorder?: boolean;
  verticalSpacing?: string;
  horizontalSpacing?: string;
};

type TdProps = TdHTMLAttributes<HTMLTableCellElement> & {
  maw?: number | string;
  ta?: CSSProperties['textAlign'];
};

type ThProps = ThHTMLAttributes<HTMLTableCellElement> & {
  ta?: CSSProperties['textAlign'];
};

function TableRoot({ striped, highlightOnHover, withTableBorder, verticalSpacing, horizontalSpacing, className, style, ...props }: TableRootProps) {
  return (
    <table
      className={cx(
        rootCls({
          withBorder: withTableBorder ? 'true' : undefined,
          striped: striped ? 'true' : undefined,
          hover: highlightOnHover ? 'true' : undefined,
        }),
        className,
      )}
      style={style}
      {...props}
    />
  );
}

function Thead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cx(theadCls, className)} {...props} />;
}

function Tbody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...props} />;
}

function Th({ ta, className, style, ...props }: ThProps) {
  return (
    <th
      className={cx(thCls, className)}
      style={{ ...(ta ? { textAlign: ta } : {}), ...style }}
      {...props}
    />
  );
}

function Td({ maw, ta, className, style, ...props }: TdProps) {
  return (
    <td
      className={cx(tdCls, className)}
      style={{
        ...(maw !== undefined ? { maxWidth: typeof maw === 'number' ? `${maw}px` : maw } : {}),
        ...(ta ? { textAlign: ta } : {}),
        ...style,
      }}
      {...props}
    />
  );
}

function ScrollContainer({ minWidth, className, style, ...props }: HTMLAttributes<HTMLDivElement> & { minWidth?: number }) {
  return (
    <div
      className={cx(scrollCls, className)}
      style={{ ...(minWidth ? { minWidth: `${minWidth}px` } : {}), ...style }}
      {...props}
    />
  );
}

export const Table = Object.assign(TableRoot, {
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  ScrollContainer,
});
