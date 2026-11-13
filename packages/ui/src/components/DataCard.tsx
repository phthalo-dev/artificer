import { type ReactNode } from 'react';
import { Stack, Surface, Text } from '@var-ui/react';
import {
  dataCardLabel,
  dataCardTile,
  dataCardValueHero,
} from './DataCard.styles';

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
    <Stack gap="xs">
      <Text
        as="div"
        size="xs"
        tone="secondary"
        weight="semibold"
        className={dataCardLabel}
      >
        {label}
      </Text>
      <Text
        as="div"
        size="lg"
        weight="semibold"
        className={size === 'lg' ? dataCardValueHero : undefined}
      >
        {value}
      </Text>
    </Stack>
  );

  if (bordered) {
    return (
      <Surface padding="sm" className={dataCardTile}>
        {content}
      </Surface>
    );
  }

  return content;
}
