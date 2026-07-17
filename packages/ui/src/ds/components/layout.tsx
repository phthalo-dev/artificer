import { type CSSProperties, type HTMLAttributes, forwardRef } from 'react';
import { cx } from '../styles';
import { space } from '../tokens';
import {
  group as groupCls,
  overflowXAuto,
  scrollArea,
  simpleGrid,
  stack as stackCls,
} from './layout.styles';

type GapKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

function spacing(v: number | string | GapKey): string {
  if (typeof v === 'string' && v in space) return space[v as GapKey];
  return typeof v === 'number' ? `${v}px` : v;
}

export type BoxProps = HTMLAttributes<HTMLDivElement> & {
  component?: React.ElementType;
  w?: number | string;
  h?: number | string;
  maw?: number | string;
  mah?: number | string;
  ml?: number | string;
  mr?: number | string;
  mt?: number | string;
  mb?: number | string;
  p?: number | string;
};

export const Box = forwardRef<HTMLDivElement, BoxProps>(function Box(
  {
    component: Tag = 'div',
    w,
    h,
    maw,
    mah,
    ml,
    mr,
    mt,
    mb,
    p,
    style,
    ...props
  },
  ref,
) {
  const s: CSSProperties = {
    ...(w !== undefined ? { width: spacing(w) } : {}),
    ...(h !== undefined ? { height: spacing(h) } : {}),
    ...(maw !== undefined ? { maxWidth: spacing(maw) } : {}),
    ...(mah !== undefined ? { maxHeight: spacing(mah) } : {}),
    ...(ml !== undefined ? { marginLeft: spacing(ml) } : {}),
    ...(mr !== undefined ? { marginRight: spacing(mr) } : {}),
    ...(mt !== undefined ? { marginTop: spacing(mt) } : {}),
    ...(mb !== undefined ? { marginBottom: spacing(mb) } : {}),
    ...(p !== undefined ? { padding: spacing(p) } : {}),
    ...style,
  };
  return (
    <Tag ref={ref} style={Object.keys(s).length ? s : undefined} {...props} />
  );
});

export type StackProps = HTMLAttributes<HTMLDivElement> & {
  gap?: GapKey | number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  mt?: number | string;
  mb?: number | string;
};

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = 'md', align, justify, mt, mb, className, style, ...props },
  ref,
) {
  const s: CSSProperties = {
    ...(typeof gap === 'number' ? { gap: `${gap}px` } : {}),
    ...(align ? { alignItems: align } : {}),
    ...(justify ? { justifyContent: justify } : {}),
    ...(mt !== undefined ? { marginTop: spacing(mt) } : {}),
    ...(mb !== undefined ? { marginBottom: spacing(mb) } : {}),
    ...style,
  };
  const gapCls =
    typeof gap === 'string' ? stackCls({ gap }) : stackCls({ gap: 'md' });
  return (
    <div
      ref={ref}
      className={cx(gapCls, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

export type GroupProps = HTMLAttributes<HTMLDivElement> & {
  gap?: GapKey | number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: CSSProperties['flexWrap'];
  grow?: boolean;
  mt?: number | string;
  mb?: number | string;
  w?: number | string;
  alignStretch?: boolean;
};

export const Group = forwardRef<HTMLDivElement, GroupProps>(function Group(
  {
    gap = 'sm',
    align,
    justify,
    wrap,
    grow,
    mt,
    mb,
    w,
    alignStretch,
    className,
    style,
    ...props
  },
  ref,
) {
  const s: CSSProperties = {
    ...(typeof gap === 'number' ? { gap: `${gap}px` } : {}),
    ...(align ? { alignItems: align } : {}),
    ...(justify ? { justifyContent: justify } : {}),
    ...(wrap ? { flexWrap: wrap } : {}),
    ...(grow ? { flex: 1 } : {}),
    ...(mt !== undefined ? { marginTop: spacing(mt) } : {}),
    ...(mb !== undefined ? { marginBottom: spacing(mb) } : {}),
    ...(w !== undefined ? { width: spacing(w) } : {}),
    ...style,
  };
  const gapCls =
    typeof gap === 'string'
      ? groupCls({ gap, alignStretch: alignStretch ? 'true' : undefined })
      : groupCls({
          gap: 'sm',
          alignStretch: alignStretch ? 'true' : undefined,
        });
  return (
    <div
      ref={ref}
      className={cx(gapCls, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

type ColsInput =
  | number
  | { base?: number; sm?: number; md?: number; lg?: number; xl?: number };

export type SimpleGridProps = HTMLAttributes<HTMLDivElement> & {
  cols?: ColsInput;
  spacing?: GapKey | number;
};

export const SimpleGrid = forwardRef<HTMLDivElement, SimpleGridProps>(
  function SimpleGrid(
    { cols = 1, spacing: gridSpacing = 'md', className, style, ...props },
    ref,
  ) {
    const colCount =
      typeof cols === 'number'
        ? cols
        : (cols.lg ?? cols.md ?? cols.sm ?? cols.base ?? 1);
    const gap =
      typeof gridSpacing === 'string' ? space[gridSpacing] : `${gridSpacing}px`;
    const s: CSSProperties = {
      gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
      gap,
      ...style,
    };
    return (
      <div
        ref={ref}
        className={cx(simpleGrid, className)}
        style={s}
        {...props}
      />
    );
  },
);

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
  type?: string;
  mah?: number | string;
  mb?: number | string | GapKey;
};

function ScrollAreaBase(
  { mah, mb, style, className, ...props }: ScrollAreaProps,
  ref: React.Ref<HTMLDivElement>,
) {
  const s: CSSProperties = {
    ...(mah !== undefined ? { maxHeight: spacing(mah) } : {}),
    ...(mb !== undefined ? { marginBottom: spacing(mb) } : {}),
    ...style,
  };
  return (
    <div
      ref={ref}
      className={cx(scrollArea, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
}

const ScrollAreaForwardRef = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ScrollAreaBase,
);

export const ScrollArea = Object.assign(ScrollAreaForwardRef, {
  Autosize: ScrollAreaForwardRef,
});

export { overflowXAuto };
