import { Link } from '@var-ui/react';
import { IconExternalLink } from '@tabler/icons-react';
import { useEffect, useMemo } from 'react';
import { t } from '../styles/system';

export function ViewRawLink({
  data,
  filename,
}: {
  data: unknown;
  filename: string;
}) {
  const href = useMemo(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    return URL.createObjectURL(blob);
  }, [data]);

  useEffect(() => () => URL.revokeObjectURL(href), [href]);

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={filename}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: t.space.xxs.var,
        fontSize: t.fontSize.xs.var,
        color: t.color.text.secondary.var,
      }}
    >
      View raw <IconExternalLink size={12} />
    </Link>
  );
}
