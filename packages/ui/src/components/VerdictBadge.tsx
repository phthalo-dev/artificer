import { Badge } from '@var-ui/react';

/** Pass/fail badge for a benchmark result; neutral while ungraded. */
export function VerdictBadge({
  resolved,
}: {
  resolved: boolean | null | undefined;
}) {
  if (resolved === true)
    return (
      <Badge tone="success" appearance="solid">
        PASS
      </Badge>
    );
  if (resolved === false) return <Badge tone="danger">FAIL</Badge>;
  return <Badge tone="neutral">ungraded</Badge>;
}
