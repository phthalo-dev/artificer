import {
  type CSSProperties,
  type HTMLAttributes,
  forwardRef,
} from 'react';
import { styles, cx } from 'typestyles';
import { space } from '../tokens';

// ── Box ──────────────────────────────────────────────────────────────

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
  { component: Tag = 'div', w, h, maw, mah, ml, mr, mt, mb, p, style, ...props },
  ref,
) {
  const s: CSSProperties = {
    ...(w !== undefined ? { width: px(w) } : {}),
    ...(h !== undefined ? { height: px(h) } : {}),
    ...(maw !== undefined ? { maxWidth: px(maw) } : {}),
    ...(mah !== undefined ? { maxHeight: px(mah) } : {}),
    ...(ml !== undefined ? { marginLeft: px(ml) } : {}),
    ...(mr !== undefined ? { marginRight: px(mr) } : {}),
    ...(mt !== undefined ? { marginTop: px(mt) } : {}),
    ...(mb !== undefined ? { marginBottom: px(mb) } : {}),
    ...(p !== undefined ? { padding: px(p) } : {}),
    ...style,
  };
  return <Tag ref={ref} style={Object.keys(s).length ? s : undefined} {...props} />;
});

function px(v: number | string): string {
  return typeof v === 'number' ? `${v}px` : v;
}

// ── Stack ─────────────────────────────────────────────────────────────

const stackCls = styles.component('nb-stack', {
  base: { display: 'flex', flexDirection: 'column' },
  variants: {
    gap: {
      xs: { gap: space.xs },
      sm: { gap: space.sm },
      md: { gap: space.md },
      lg: { gap: space.lg },
      xl: { gap: space.xl },
    },
  },
  defaultVariants: { gap: 'md' },
});

type GapKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type StackProps = HTMLAttributes<HTMLDivElement> & {
  gap?: GapKey | number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
};

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = 'md', align, justify, className, style, ...props },
  ref,
) {
  const s: CSSProperties = {
    ...(typeof gap === 'number' ? { gap: `${gap}px` } : {}),
    ...(align ? { alignItems: align } : {}),
    ...(justify ? { justifyContent: justify } : {}),
    ...style,
  };
  const gapCls = typeof gap === 'string' ? stackCls({ gap }) : stackCls({ gap: 'md' });
  return (
    <div
      ref={ref}
      className={cx(gapCls, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

// ── Group ─────────────────────────────────────────────────────────────

const groupCls = styles.component('nb-group', {
  base: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
  variants: {
    gap: {
      xs: { gap: space.xs },
      sm: { gap: space.sm },
      md: { gap: space.md },
      lg: { gap: space.lg },
      xl: { gap: space.xl },
    },
  },
  defaultVariants: { gap: 'sm' },
});

export type GroupProps = HTMLAttributes<HTMLDivElement> & {
  gap?: GapKey | number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: CSSProperties['flexWrap'];
  grow?: boolean;
};

export const Group = forwardRef<HTMLDivElement, GroupProps>(function Group(
  { gap = 'sm', align, justify, wrap, grow, className, style, ...props },
  ref,
) {
  const s: CSSProperties = {
    ...(typeof gap === 'number' ? { gap: `${gap}px` } : {}),
    ...(align ? { alignItems: align } : {}),
    ...(justify ? { justifyContent: justify } : {}),
    ...(wrap ? { flexWrap: wrap } : {}),
    ...style,
  };
  const gapCls = typeof gap === 'string' ? groupCls({ gap }) : groupCls({ gap: 'sm' });
  return (
    <div
      ref={ref}
      className={cx(gapCls, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

// ── SimpleGrid ────────────────────────────────────────────────────────

type ColsInput =
  | number
  | { base?: number; sm?: number; md?: number; lg?: number; xl?: number };

export type SimpleGridProps = HTMLAttributes<HTMLDivElement> & {
  cols?: ColsInput;
  spacing?: GapKey | number;
};

export const SimpleGrid = forwardRef<HTMLDivElement, SimpleGridProps>(
  function SimpleGrid({ cols = 1, spacing = 'md', style, ...props }, ref) {
    const colCount = typeof cols === 'number' ? cols : (cols.lg ?? cols.md ?? cols.sm ?? cols.base ?? 1);
    const gap = typeof spacing === 'string' ? `var(--nb-space-${spacing})` : `${spacing}px`;
    return (
      <div
        ref={ref}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
          gap,
          ...style,
        }}
        {...props}
      />
    );
  },
);

// ── ScrollArea ─────────────────────────────────────────────────────────

const scrollCls = styles.class('nb-scroll-area', { overflow: 'auto' });

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
  type?: string;
  mah?: number | string;
};

function ScrollAreaBase(
  { mah, style, className, ...props }: ScrollAreaProps,
  ref: React.Ref<HTMLDivElement>,
) {
  return (
    <div
      ref={ref}
      className={cx(scrollCls, className)}
      style={{ ...(mah !== undefined ? { maxHeight: px(mah) } : {}), ...style }}
      {...props}
    />
  );
}

const ScrollAreaForwardRef = forwardRef<HTMLDivElement, ScrollAreaProps>(ScrollAreaBase);

export const ScrollArea = Object.assign(ScrollAreaForwardRef, {
  Autosize: ScrollAreaForwardRef,
});
