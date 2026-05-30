import { Group, Paper, Text } from '@mantine/core';
import type { UsageSummary } from '../api/types';
import { formatCost, formatTokens } from '../format';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="sm" radius="md" style={{ flex: 1, minWidth: 120 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="lg" fw={700}>
        {value}
      </Text>
    </Paper>
  );
}

export function UsageStats({ usage }: { usage: UsageSummary }) {
  return (
    <Group gap="sm" grow wrap="wrap">
      <Stat label="Cost" value={formatCost(usage.costUsd)} />
      <Stat label="Calls" value={String(usage.runs)} />
      <Stat label="Requests" value={String(usage.requests)} />
      <Stat label="Input tokens" value={formatTokens(usage.inputTokens)} />
      <Stat label="Output tokens" value={formatTokens(usage.outputTokens)} />
    </Group>
  );
}
