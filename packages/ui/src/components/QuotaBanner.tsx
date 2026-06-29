import { Alert, Badge, Group } from '../ds';
import { useUsage } from '../api/hooks';
import { accountStatusColor, quotaHeadline } from '../quota';

/** Compact quota status for the app header. */
export function QuotaBanner() {
  const { data } = useUsage();
  const snapshot = data?.quota;
  const headline = quotaHeadline(snapshot);
  if (!headline || !snapshot) return null;

  const worst = Object.values(snapshot.accounts).reduce<
    'ok' | 'warning' | 'exhausted' | 'unknown'
  >((acc, a) => {
    if (a.status === 'exhausted') return 'exhausted';
    if (a.status === 'warning' && acc !== 'exhausted') return 'warning';
    return acc;
  }, 'ok');

  const color = accountStatusColor(worst);

  return (
    <Badge color={color} variant="light" title={headline}>
      {headline.length > 48 ? `${headline.slice(0, 45)}…` : headline}
    </Badge>
  );
}

/** Full-width alert for pages when quota is exhausted or in warning. */
export function QuotaAlert() {
  const { data } = useUsage();
  const snapshot = data?.quota;
  const headline = quotaHeadline(snapshot);
  if (!headline || !snapshot) return null;

  const exhausted = Object.values(snapshot.accounts).some(
    (a) => a.status === 'exhausted',
  );
  const failover = Object.values(snapshot.activeRoutes).some(
    (r) => r !== 'primary',
  );

  return (
    <Alert
      color={exhausted ? 'orange' : failover ? 'blue' : 'orange'}
      title={exhausted ? 'Usage quota reached' : failover ? 'Provider failover' : 'Quota warning'}
    >
      <Group gap="xs">{headline}</Group>
    </Alert>
  );
}
