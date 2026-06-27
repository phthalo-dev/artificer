import {
  type CSSProperties,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cx } from '../styles';
import {
  tableRoot,
  tableScroll,
  tableTd,
  tableTh,
  tableThead,
} from './table.styles';

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
  minWidth?: number;
};

type ThProps = ThHTMLAttributes<HTMLTableCellElement> & {
  ta?: CSSProperties['textAlign'];
};

function TableRoot({
  striped,
  highlightOnHover,
  withTableBorder,
  verticalSpacing,
  horizontalSpacing,
  className,
  style,
  ...props
}: TableRootProps) {
  return (
    <table
      className={cx(
        tableRoot({
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
  return <thead className={cx(tableThead, className)} {...props} />;
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
      className={cx(tableTh, className)}
      style={{ ...(ta ? { textAlign: ta } : {}), ...style }}
      {...props}
    />
  );
}

function Td({ maw, minWidth, ta, className, style, ...props }: TdProps) {
  return (
    <td
      className={cx(tableTd, className)}
      style={{
        ...(maw !== undefined
          ? { maxWidth: typeof maw === 'number' ? `${maw}px` : maw }
          : {}),
        ...(minWidth ? { minWidth: `${minWidth}px` } : {}),
        ...(ta ? { textAlign: ta } : {}),
        ...style,
      }}
      {...props}
    />
  );
}

function ScrollContainer({
  minWidth,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { minWidth?: number }) {
  return (
    <div
      className={cx(tableScroll, className)}
      style={{
        ...(minWidth ? { minWidth: `${minWidth}px` } : {}),
        ...style,
      }}
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
