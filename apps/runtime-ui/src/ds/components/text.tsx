import { type CSSProperties, type HTMLAttributes, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font } from '../tokens';

const textCls = styles.component('nb-text', {
  base: {
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    color: color.text,
    lineHeight: '1.5',
  },
  variants: {
    size: {
      xs: { fontSize: font.sizeXs },
      sm: { fontSize: font.sizeSm },
      md: { fontSize: font.sizeMd },
      lg: { fontSize: font.sizeLg },
      xl: { fontSize: font.sizeXl },
    },
    c: {
      dimmed:  { color: color.dimmed },
      muted:   { color: color.muted },
      red:     { color: color.red },
      green:   { color: color.green },
      blue:    { color: color.blue },
      orange:  { color: color.orange },
      cyan:    { color: color.cyan },
      violet:  { color: color.violet },
      grape:   { color: color.grape },
      teal:    { color: color.teal },
      indigo:  { color: color.indigo },
      gray:    { color: color.gray },
      inherit: { color: 'inherit' },
    },
    upper: {
      true: { textTransform: 'uppercase', letterSpacing: '0.05em' },
    },
    mono: {
      true: { fontFamily: font.familyMono },
    },
  },
  defaultVariants: { size: 'md' },
});

type TextColor =
  | 'dimmed' | 'muted' | 'red' | 'green' | 'blue' | 'orange'
  | 'cyan' | 'violet' | 'grape' | 'teal' | 'indigo' | 'gray' | 'inherit';

export type TextProps = HTMLAttributes<HTMLElement> & {
  component?: React.ElementType;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  c?: TextColor;
  fw?: number;
  fz?: number | string;
  lh?: number | string;
  tt?: 'uppercase' | 'lowercase' | 'capitalize';
  ff?: 'monospace' | string;
  lineClamp?: number;
  ta?: 'left' | 'right' | 'center';
  w?: number | string;
  maw?: number | string;
  mt?: number | string;
  mb?: number | string;
};

export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    component: Tag = 'span',
    size = 'md',
    c,
    fw,
    fz,
    lh,
    tt,
    ff,
    lineClamp,
    ta,
    w,
    maw,
    mt,
    mb,
    className,
    style,
    ...props
  },
  ref,
) {
  const cls = textCls({
    size,
    c: c as any,
    upper: tt === 'uppercase' ? 'true' : undefined,
    mono: ff === 'monospace' ? 'true' : undefined,
  });

  const s: CSSProperties = {
    ...(fw ? { fontWeight: fw } : {}),
    ...(fz ? { fontSize: typeof fz === 'number' ? `${fz}px` : fz } : {}),
    ...(lh ? { lineHeight: lh } : {}),
    ...(tt && tt !== 'uppercase' ? { textTransform: tt } : {}),
    ...(ff && ff !== 'monospace' ? { fontFamily: ff } : {}),
    ...(lineClamp ? { display: '-webkit-box', WebkitLineClamp: lineClamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
    ...(ta ? { textAlign: ta } : {}),
    ...(w !== undefined ? { width: typeof w === 'number' ? `${w}px` : w } : {}),
    ...(maw !== undefined ? { maxWidth: typeof maw === 'number' ? `${maw}px` : maw } : {}),
    ...(mt !== undefined ? { marginTop: typeof mt === 'number' ? `${mt}px` : mt } : {}),
    ...(mb !== undefined ? { marginBottom: typeof mb === 'number' ? `${mb}px` : mb } : {}),
    ...style,
  };

  return (
    <Tag
      ref={ref}
      className={cx(cls, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

// ── Title ─────────────────────────────────────────────────────────────

const titleCls = styles.component('nb-title', {
  base: {
    fontFamily: font.familySans,
    fontWeight: font.w700,
    color: color.text,
    lineHeight: '1.2',
  },
  variants: {
    order: {
      '1': { fontSize: font.size4xl },
      '2': { fontSize: font.size3xl },
      '3': { fontSize: font.size2xl },
      '4': { fontSize: font.sizeXl },
      '5': { fontSize: font.sizeLg, fontWeight: font.w600 },
      '6': { fontSize: font.sizeMd, fontWeight: font.w600 },
    },
  },
  defaultVariants: { order: '3' },
});

const TAG_FOR_ORDER: Record<number, React.ElementType> = {
  1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6',
};

export type TitleProps = HTMLAttributes<HTMLHeadingElement> & {
  order?: 1 | 2 | 3 | 4 | 5 | 6;
};

export const Title = forwardRef<HTMLHeadingElement, TitleProps>(function Title(
  { order = 3, className, ...props },
  ref,
) {
  const Tag = TAG_FOR_ORDER[order];
  return (
    <Tag
      ref={ref}
      className={cx(titleCls({ order: String(order) as any }), className)}
      {...props}
    />
  );
});
