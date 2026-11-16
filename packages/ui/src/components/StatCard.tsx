import { Card, Stack, Text } from '@var-ui/react';
import type { ReactNode } from 'react';
import { eyebrow } from '../styles/shared';
import { style, t } from '../styles/system';

export const statValue = style('stat-value', {
  fontSize: t.fontSize.xxl.var,
  fontWeight: t.fontWeight.bold.var,
  lineHeight: t.lineHeight.tight.var,
  margin: 0,
});

export const metricValue = style('metric-value', {
  fontSize: t.fontSize.xl.var,
  fontWeight: t.fontWeight.bold.var,
  lineHeight: t.lineHeight.tight.var,
  margin: 0,
});

/** A labelled statistic: "card" wraps it in a Card, "inline" is bare (for Grids). */
export function StatCard({
  label,
  value,
  sub,
  variant = 'card',
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  variant?: 'card' | 'inline';
}) {
  const body = (
    <Stack gap="xs">
      <Text size="xs" tone="secondary" weight="semibold" className={eyebrow}>
        {label}
      </Text>
      <p className={variant === 'card' ? statValue : metricValue}>{value}</p>
      {sub && (
        <Text size="xs" tone="secondary">
          {sub}
        </Text>
      )}
    </Stack>
  );
  if (variant === 'inline') return body;
  return <Card>{body}</Card>;
}
