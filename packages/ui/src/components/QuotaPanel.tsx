import {
  Badge,
  Button,
  Card,
  Code,
  Heading,
  HStack,
  Meter,
  Stack,
  Surface,
  Text,
} from '@var-ui/react';
import { useResetQuotaWindow, useUsage } from '../api/hooks';
import type { QuotaAccountState, QuotaWindowState } from '../api/types';
import {
  formatQuotaUnit,
  formatUntil,
  windowLabel,
  windowPercent,
  windowUsed,
} from '../quota';
import { accountStatusTone } from './QuotaBanner';

function WindowRow({ window }: { window: QuotaWindowState }) {
  const pct = windowPercent(window);
  const used = windowUsed(window);
  const { limit, unit, blockAtPercent = 90 } = window.config;
  const blockPct = Math.min(100, blockAtPercent);

  return (
    <Stack gap="xs">
      <Meter
        label={windowLabel(window)}
        value={pct}
        valueLabel={`${formatQuotaUnit(unit, used)} / ${formatQuotaUnit(unit, limit)}`}
        tone={pct >= blockPct ? 'danger' : pct >= 70 ? 'warning' : 'info'}
      />
      <HStack justify="between">
        <Text size="xs" tone="secondary">
          {Math.round(pct)}% used · source: {window.source}
        </Text>
        {window.resetsAt && (
          <Text size="xs" tone="secondary">
            resets {formatUntil(window.resetsAt)}
          </Text>
        )}
      </HStack>
    </Stack>
  );
}

function AccountCard({ account }: { account: QuotaAccountState }) {
  const reset = useResetQuotaWindow();
  const activeRoute = account.config.id;

  return (
    <Card>
      <Stack gap="md">
        <HStack justify="between">
          <HStack gap="xs">
            <Text weight="semibold">{account.config.id}</Text>
            <Badge tone={accountStatusTone(account.status)}>
              {account.status}
            </Badge>
            <Badge appearance="outline">{account.config.mode}</Badge>
          </HStack>
          {account.config.onExhausted && (
            <Text size="xs" tone="secondary">
              on exhaust: {account.config.onExhausted}
            </Text>
          )}
        </HStack>
        {account.windows.map((w) => (
          <Stack key={w.config.id} gap="xs" align="start">
            <div style={{ alignSelf: 'stretch' }}>
              <WindowRow window={w} />
            </div>
            {w.config.period === 'fixed' && (
              <Button
                appearance="outline"
                size="sm"
                loading={reset.isPending}
                onClick={() =>
                  reset.mutate({
                    accountId: activeRoute,
                    windowId: w.config.id,
                  })
                }
              >
                Reset window
              </Button>
            )}
          </Stack>
        ))}
        {(account.config.failover?.length ?? 0) > 0 && (
          <Text size="xs" tone="secondary">
            Failover: {account.config.failover!.map((f) => f.id).join(' → ')}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

export function QuotaPanel() {
  const { data } = useUsage();
  const snapshot = data?.quota;

  if (!snapshot || Object.keys(snapshot.accounts).length === 0) {
    return (
      <Text tone="secondary" size="sm">
        No quota windows configured. Add a <Code>quota</Code> block to{' '}
        <Code>artificer.config.json</Code> or set{' '}
        <Code>QUOTA_DAILY_BUDGET_USD</Code> for a metered cap.
      </Text>
    );
  }

  const failoverRoutes = Object.entries(snapshot.activeRoutes).filter(
    ([, route]) => route !== 'primary',
  );

  return (
    <Stack gap="md">
      <HStack justify="between">
        <Heading level={5} size="xs">
          Quota &amp; budgets
        </Heading>
        <Text size="xs" tone="secondary">
          communicator reserve: {snapshot.reservePercent}%
        </Text>
      </HStack>

      {failoverRoutes.length > 0 && (
        <Surface padding="sm">
          <Stack gap="xs">
            <Text size="sm" weight="semibold">
              Active failover routes
            </Text>
            {failoverRoutes.map(([accountId, route]) => (
              <Text key={accountId} size="sm" tone="secondary">
                {accountId} → <strong>{route}</strong>
              </Text>
            ))}
          </Stack>
        </Surface>
      )}

      {Object.values(snapshot.accounts).map((account) => (
        <AccountCard key={account.config.id} account={account} />
      ))}
    </Stack>
  );
}
