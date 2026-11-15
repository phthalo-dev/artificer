import { HStack, Stack, Text } from '@var-ui/react';
import { roleColor, tokenLayerColor } from '../styles/palette';
import type { UsageSummary } from '../api/types';
import { formatCost, formatTokens } from '../format';
import { totalTokens } from '../usage-breakdown';
import {
  eyebrow,
  legendSwatchSm,
  roleBarSegment,
  roleBarTrack,
} from './TokenSpendChart.styles';

function colorForRole(role: string): string {
  return roleColor[role] ?? tokenLayerColor.gray;
}

/** Single horizontal bar: token share by role. */
export function TokenSpendByRole({
  byRole,
}: {
  byRole: Record<string, UsageSummary>;
}) {
  const rows = Object.entries(byRole)
    .map(([role, usage]) => ({
      role,
      usage,
      tokens: totalTokens(usage),
    }))
    .filter((r) => r.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  const grandTotal = rows.reduce((sum, r) => sum + r.tokens, 0);
  if (grandTotal === 0) return null;

  return (
    <Stack gap="sm">
      <Text size="xs" tone="secondary" weight="semibold" className={eyebrow}>
        Token spend by role
      </Text>
      <div className={roleBarTrack}>
        {rows.map(({ role, usage, tokens }) => {
          const pct = (tokens / grandTotal) * 100;
          return (
            <div
              key={role}
              className={roleBarSegment}
              title={`${role} · ${formatTokens(tokens)} tok · ${formatCost(usage.costUsd)}`}
              style={{
                width: `${pct}%`,
                minWidth: pct > 0 ? 4 : 0,
                backgroundColor: colorForRole(role),
              }}
            />
          );
        })}
      </div>
      <HStack gap="md" wrap>
        {rows.map(({ role, usage, tokens }) => (
          <HStack key={role} gap="xs">
            <span
              className={legendSwatchSm}
              style={{ backgroundColor: colorForRole(role) }}
            />
            <Text as="span" size="xs" tone="secondary">
              {role} {((tokens / grandTotal) * 100).toFixed(0)}% ·{' '}
              {formatCost(usage.costUsd)}
            </Text>
          </HStack>
        ))}
      </HStack>
    </Stack>
  );
}
