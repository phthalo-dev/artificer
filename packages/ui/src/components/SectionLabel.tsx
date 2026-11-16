import { Text } from '@var-ui/react';
import type { ReactNode } from 'react';
import { eyebrow } from '../styles/shared';

/** Small uppercase label above a section ("Summary", "Steps", …). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      as="span"
      size="xs"
      tone="secondary"
      weight="semibold"
      className={eyebrow}
    >
      {children}
    </Text>
  );
}
