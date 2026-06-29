import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Progress,
  Stack,
  Text,
  Title,
} from '../ds';
import { useResetQuotaWindow, useUsage } from '../api/hooks';
import type { QuotaAccountState, QuotaWindowState } from '../api/types';
import {
  accountStatusColor,
  formatQuotaUnit,
  formatUntil,
  windowLabel,
  windowPercent,
  windowUsed,
} from '../quota';

function WindowRow({ window }: { window: QuotaWindowState }) {
  const pct = windowPercent(window);
  const used = windowUsed(window);
  const { limit, unit, blockAtPercent = 90 } = window.config;
  const blockPct = Math.min(100, blockAtPercent);

  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={500}>
          {windowLabel(window)}
        </Text>
        <Text size="xs" c="dimmed">
          {formatQuotaUnit(unit, used)} / {formatQuotaUnit(unit, limit)}
        </Text>
      </Group>
      <Progress value={pct} color={pct >= blockPct ? 'red' : pct >= 70 ? 'yellow' : 'blue'} />
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {Math.round(pct)}% used · source: {window.source}
        </Text>
        {window.resetsAt && (
          <Text size="xs" c="dimmed">
            resets {formatUntil(window.resetsAt)}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

function AccountCard({ account }: { account: QuotaAccountState }) {
  const reset = useResetQuotaWindow();
  const activeRoute = account.config.id;

  return (
    <Card padding="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Text fw={600}>{account.config.id}</Text>
          <Badge color={accountStatusColor(account.status)} variant="light">
            {account.status}
          </Badge>
          <Badge color="gray" variant="outline">
            {account.config.mode}
          </Badge>
        </Group>
        {account.config.onExhausted && (
          <Text size="xs" c="dimmed">
            on exhaust: {account.config.onExhausted}
          </Text>
        )}
      </Group>
      <Stack gap="md">
        {account.windows.map((w) => (
          <div key={w.config.id}>
            <WindowRow window={w} />
            {w.config.period === 'fixed' && (
              <Button
                variant="outline"
                size="sm"
                loading={reset.isPending}
                onPress={() =>
                  reset.mutate({ accountId: activeRoute, windowId: w.config.id })
                }
              >
                Reset window
              </Button>
            )}
          </div>
        ))}
        {(account.config.failover?.length ?? 0) > 0 && (
          <Text size="xs" c="dimmed">
            Failover:{' '}
            {account.config.failover!.map((f) => f.id).join(' → ')}
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
      <Text c="dimmed" size="sm">
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
      <Group justify="space-between">
        <Title order={5}>Quota &amp; budgets</Title>
        <Text size="xs" c="dimmed">
          communicator reserve: {snapshot.reservePercent}%
        </Text>
      </Group>

      {failoverRoutes.length > 0 && (
        <Card padding="sm" withBorder>
          <Text size="sm" fw={600} mb={4}>
            Active failover routes
          </Text>
          {failoverRoutes.map(([accountId, route]) => (
            <Text key={accountId} size="sm" c="dimmed">
              {accountId} → <strong>{route}</strong>
            </Text>
          ))}
        </Card>
      )}

      {Object.values(snapshot.accounts).map((account) => (
        <AccountCard key={account.config.id} account={account} />
      ))}
    </Stack>
  );
}
