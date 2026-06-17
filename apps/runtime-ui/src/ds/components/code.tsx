import { type HTMLAttributes, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font } from '../tokens';

const inlineCls = styles.class('nb-code-inline', {
  fontFamily: font.familyMono,
  fontSize: '0.88em',
  background: color.grayLight,
  border: `1px solid ${color.grayBg}`,
  borderRadius: '0',
  padding: '1px 5px',
  color: color.text,
});

const blockCls = styles.class('nb-code-block', {
  fontFamily: font.familyMono,
  fontSize: font.sizeSm,
  background: color.grayLight,
  border: `2px solid ${color.border}`,
  borderRadius: '0',
  padding: '12px 16px',
  overflowX: 'auto',
  display: 'block',
  whiteSpace: 'pre-wrap',
  color: color.text,
});

export type CodeProps = HTMLAttributes<HTMLElement> & {
  block?: boolean;
  c?: string;
};

export const Code = forwardRef<HTMLElement, CodeProps>(function Code(
  { block, c, className, style, ...props },
  ref,
) {
  if (block) {
    return (
      <code
        ref={ref}
        className={cx(blockCls, className)}
        style={{ ...(c ? { color: c } : {}), ...style }}
        {...props}
      />
    );
  }
  return (
    <code
      ref={ref}
      className={cx(inlineCls, className)}
      style={{ ...(c ? { color: c } : {}), ...style }}
      {...props}
    />
  );
});
