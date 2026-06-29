import { type ReactNode } from 'react';
import { Paper, Stack, Text } from '../ds';

export type DataCardProps = {
  label: string;
  value: ReactNode;
  /** Larger value typography for hero metric rows */
  size?: 'md' | 'lg';
  /** Wrap in a bordered surface (dashboard stat tiles) */
  bordered?: boolean;
};

export function DataCard({
  label,
  value,
  size = 'md',
  bordered = false,
}: DataCardProps) {
  const content = (
    <Stack gap={4}>
      <Text component="div" size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text
        component="div"
        size={size === 'lg' ? undefined : 'lg'}
        fz={size === 'lg' ? 22 : undefined}
        fw={700}
        lh={size === 'lg' ? 1 : undefined}
      >
        {value}
      </Text>
    </Stack>
  );

  if (bordered) {
    return (
      <Paper p="sm" flex>
        {content}
      </Paper>
    );
  }

  return content;
}
