import { type HTMLAttributes } from 'react';
import { progressBar, progressTrack } from './progress.styles';

export type ProgressProps = HTMLAttributes<HTMLDivElement> & {
  value: number;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  radius?: string;
};

export function Progress({
  value,
  color: c,
  size = 'md',
  radius,
  style,
  ...props
}: ProgressProps) {
  return (
    <div className={progressTrack({ size })} style={style} {...props}>
      <div
        className={progressBar}
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          ...(c ? { background: c } : {}),
        }}
      />
    </div>
  );
}
