import { type CSSProperties, type HTMLAttributes, forwardRef } from 'react';
import { cx } from '../styles';
import { space } from '../tokens';
import { text as textCls, title as titleCls } from './text.styles';

type GapKey = keyof typeof space;
type SpacingValue = number | string | GapKey;

function spacing(v: SpacingValue): string {
  if (typeof v === 'string' && v in space) return space[v as GapKey];
  return typeof v === 'number' ? `${v}px` : v;
}

type TextColor =
  | 'dimmed'
  | 'muted'
  | 'red'
  | 'green'
  | 'blue'
  | 'orange'
  | 'cyan'
  | 'violet'
  | 'grape'
  | 'teal'
  | 'indigo'
  | 'gray'
  | 'inherit';

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
  mt?: SpacingValue;
  mb?: SpacingValue;
  preWrap?: boolean;
};

export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    component: Tag = 'div',
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
    preWrap,
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
    preWrap: preWrap ? 'true' : undefined,
  });

  const s: CSSProperties = {
    ...(fw ? { fontWeight: fw } : {}),
    ...(fz ? { fontSize: typeof fz === 'number' ? `${fz}px` : fz } : {}),
    ...(lh ? { lineHeight: lh } : {}),
    ...(tt && tt !== 'uppercase' ? { textTransform: tt } : {}),
    ...(ff && ff !== 'monospace' ? { fontFamily: ff } : {}),
    ...(lineClamp
      ? {
          display: '-webkit-box',
          WebkitLineClamp: lineClamp,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }
      : {}),
    ...(ta ? { textAlign: ta } : {}),
    ...(w !== undefined
      ? { width: typeof w === 'number' ? `${w}px` : w }
      : {}),
    ...(maw !== undefined
      ? { maxWidth: typeof maw === 'number' ? `${maw}px` : maw }
      : {}),
    ...(mt !== undefined ? { marginTop: spacing(mt) } : {}),
    ...(mb !== undefined ? { marginBottom: spacing(mb) } : {}),
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

const TAG_FOR_ORDER: Record<number, React.ElementType> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

export type TitleProps = HTMLAttributes<HTMLHeadingElement> & {
  order?: 1 | 2 | 3 | 4 | 5 | 6;
  mb?: SpacingValue;
};

export const Title = forwardRef<HTMLHeadingElement, TitleProps>(function Title(
  { order = 3, mb, className, style, ...props },
  ref,
) {
  const Tag = TAG_FOR_ORDER[order];
  const s: CSSProperties = {
    ...(mb !== undefined ? { marginBottom: spacing(mb) } : {}),
    ...style,
  };
  return (
    <Tag
      ref={ref}
      className={cx(titleCls({ order: String(order) as any }), className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});
