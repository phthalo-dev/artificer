import { Anchor } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useEffect, useMemo } from 'react';

export function ViewRawLink({ data, filename }: { data: unknown; filename: string }) {
  const href = useMemo(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    return URL.createObjectURL(blob);
  }, [data]);

  useEffect(() => () => URL.revokeObjectURL(href), [href]);

  return (
    <Anchor
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={filename}
      size="xs"
      c="dimmed"
    >
      View raw <IconExternalLink size={12} style={{ verticalAlign: -2 }} />
    </Anchor>
  );
}
