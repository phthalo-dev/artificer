import { type HTMLAttributes } from 'react';
import { styles } from 'typestyles';
import { color } from '../tokens';

const trackCls = styles.class('nb-progress-track', {
  width: '100%',
  height: '12px',
  background: color.grayLight,
  border: `2px solid ${color.border}`,
  borderRadius: '0',
  overflow: 'hidden',
});

const barCls = styles.class('nb-progress-bar', {
  height: '100%',
  background: color.blue,
  transition: 'width 300ms ease',
});

export type ProgressProps = HTMLAttributes<HTMLDivElement> & {
  value: number;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  radius?: string;
};

export function Progress({ value, color: c, size, radius, style, ...props }: ProgressProps) {
  const heightMap = { xs: '6px', sm: '8px', md: '12px', lg: '16px' };
  const h = size ? heightMap[size] : '12px';
  return (
    <div className={trackCls} style={{ height: h, ...style }} {...props}>
      <div
        className={barCls}
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, ...(c ? { background: c } : {}) }}
      />
    </div>
  );
}
