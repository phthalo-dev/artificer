import { Card, HStack, Stack, Text } from '@var-ui/react';
import { roleColor, tokenLayerColor } from '../styles/palette';
import type { RunRecord, TokenUsage, UsageSummary } from '../api/types';
import { costForRun } from '../cost';
import { formatCost, formatTokens } from '../format';
import {
  eyebrow,
  legendSwatchMd,
  legendSwatchSm,
  roleBarSegment,
  roleBarTrack,
  stackedBar,
  stackedBarEmpty,
  timelineScroll,
} from './TokenSpendChart.styles';

const TOKEN_LAYERS = [
  { key: 'inputTokens' as const, label: 'Input', color: 'blue' as const },
  { key: 'outputTokens' as const, label: 'Output', color: 'teal' as const },
  {
    key: 'cacheReadInputTokens' as const,
    label: 'Cache read',
    color: 'gray' as const,
  },
  {
    key: 'cacheCreationInputTokens' as const,
    label: 'Cache write',
    color: 'orange' as const,
  },
];

function colorForRole(role: string): string {
  return roleColor[role] ?? tokenLayerColor.gray;
}

function totalTokens(u: TokenUsage): number {
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheReadInputTokens +
    u.cacheCreationInputTokens
  );
}

function summarizeRun(run: RunRecord): UsageSummary {
  const u = run.usage;
  return {
    ...u,
    runs: 1,
    costUsd: costForRun(run),
  };
}

function mergeUsage(target: UsageSummary, source: UsageSummary): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.requests += source.requests;
  target.runs += source.runs;
  target.costUsd += source.costUsd;
}

export function groupRunsByRole(
  runs: RunRecord[],
): Record<string, UsageSummary> {
  const groups: Record<string, UsageSummary> = {};
  for (const run of runs) {
    const summary = summarizeRun(run);
    const key = run.role;
    if (!groups[key]) {
      groups[key] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        requests: 0,
        runs: 0,
        costUsd: 0,
      };
    }
    mergeUsage(groups[key], summary);
  }
  for (const key of Object.keys(groups)) {
    groups[key].costUsd =
      Math.round(groups[key].costUsd * 1_000_000) / 1_000_000;
  }
  return groups;
}

function Legend() {
  return (
    <HStack gap="md" wrap>
      {TOKEN_LAYERS.map((layer) => (
        <HStack key={layer.key} gap="xs">
          <span
            className={legendSwatchMd}
            style={{ backgroundColor: tokenLayerColor[layer.color] }}
          />
          <Text as="span" size="xs" tone="secondary">
            {layer.label}
          </Text>
        </HStack>
      ))}
    </HStack>
  );
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

function StackedBar({
  usage,
  height,
  width,
  opacity = 1,
}: {
  usage: TokenUsage;
  height: number;
  width: number | string;
  opacity?: number;
}) {
  const total = totalTokens(usage);
  if (total === 0) {
    return (
      <div className={stackedBarEmpty} style={{ width, height, opacity }} />
    );
  }

  return (
    <div className={stackedBar} style={{ width, height, opacity }}>
      {TOKEN_LAYERS.map((layer) => {
        const value = usage[layer.key];
        if (!value) return null;
        const pct = (value / total) * 100;
        return (
          <div
            key={layer.key}
            style={{
              height: `${pct}%`,
              minHeight: pct > 0 ? 1 : 0,
              backgroundColor: tokenLayerColor[layer.color],
            }}
          />
        );
      })}
    </div>
  );
}

/** Per-call timeline: bar width ∝ tokens, stacked by token type. */
export function TokenSpendTimeline({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) return null;

  const totals = runs.map((run) => totalTokens(run.usage));
  const maxTokens = Math.max(...totals, 1);
  const minW = 4;
  const maxW = 48;

  return (
    <Card>
      <Stack gap="sm">
        <HStack justify="between">
          <Text
            size="xs"
            tone="secondary"
            weight="semibold"
            className={eyebrow}
          >
            Token timeline
          </Text>
          <Text size="xs" tone="secondary">
            width = tokens per call
          </Text>
        </HStack>
        <div className={timelineScroll}>
          {runs.map((run, i) => {
            const tokens = totals[i];
            const width =
              tokens === 0 ? minW : minW + (tokens / maxTokens) * (maxW - minW);
            const layers = TOKEN_LAYERS.map((layer) => ({
              ...layer,
              value: run.usage[layer.key],
            })).filter((l) => l.value > 0);

            const layerLines = layers
              .map((l) => `${l.label}: ${formatTokens(l.value)}`)
              .join('\n');
            const toolLine =
              run.toolCalls.length > 0
                ? `\n${run.toolCalls.length} tool calls`
                : '';
            const tooltipTitle = `#${i + 1} · ${run.role}\n${formatTokens(tokens)} tokens\n${layerLines}${toolLine}`;

            return (
              <div key={run.id} title={tooltipTitle}>
                <StackedBar
                  usage={run.usage}
                  height={40}
                  width={width}
                  opacity={run.status === 'failed' ? 0.45 : 1}
                />
              </div>
            );
          })}
        </div>
        <Legend />
      </Stack>
    </Card>
  );
}

/** Overview by role plus per-call token timeline. */
export function TokenSpendChart({ runs }: { runs: RunRecord[] }) {
  const byRole = groupRunsByRole(runs);
  return (
    <Stack gap="sm">
      <TokenSpendByRole byRole={byRole} />
      <TokenSpendTimeline runs={runs} />
    </Stack>
  );
}
