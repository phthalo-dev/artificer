import { Alert, Badge } from '@var-ui/react';
import type { Tone } from '@var-ui/core';
import { useUsage } from '../api/hooks';
import type { QuotaAccountState } from '../api/types';
import { quotaHeadline } from '../quota';

/** Semantic tone for a quota account status. */
export function accountStatusTone(status: QuotaAccountState['status']): Tone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warning':
      return 'warning';
    case 'exhausted':
      return 'danger';
    default:
      return 'neutral';
  }
}

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

  return (
    <Badge tone={accountStatusTone(worst)} title={headline}>
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
      tone={exhausted ? 'warning' : failover ? 'info' : 'warning'}
      title={
        exhausted
          ? 'Usage quota reached'
          : failover
            ? 'Provider failover'
            : 'Quota warning'
      }
    >
      {headline}
    </Alert>
  );
}
