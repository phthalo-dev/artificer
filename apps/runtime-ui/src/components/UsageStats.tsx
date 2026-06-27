import { Group } from '../ds';
import type { UsageSummary } from '../api/types';
import { DataCard } from './DataCard';
import { formatCost, formatTokens } from '../format';

export function UsageStats({ usage }: { usage: UsageSummary }) {
  return (
    <Group gap="sm" wrap="wrap" alignStretch>
      <DataCard bordered label="Cost" value={formatCost(usage.costUsd)} />
      <DataCard bordered label="Calls" value={String(usage.runs)} />
      <DataCard bordered label="Requests" value={String(usage.requests)} />
      <DataCard bordered label="Input tokens" value={formatTokens(usage.inputTokens)} />
      <DataCard bordered label="Output tokens" value={formatTokens(usage.outputTokens)} />
    </Group>
  );
}
