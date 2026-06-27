import { Box, Group, Paper, Stack, Text } from '../ds';
import { roleColor, tokenLayerColor } from '../ds/tokens';
import type { RunRecord, TokenUsage, UsageSummary } from '../api/types';
import { costForRun } from '../cost';
import { formatCost, formatTokens } from '../format';
import {
  legendSwatchMd,
  legendSwatchSm,
  roleBarSegment,
  roleBarTrack,
  stackedBar,
  stackedBarEmpty,
  stackedBarLayer,
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
    <Group gap="md" mt={6}>
      {TOKEN_LAYERS.map((layer) => (
        <Group key={layer.key} gap={6}>
          <span
            className={legendSwatchMd}
            style={{ backgroundColor: tokenLayerColor[layer.color] }}
          />
          <Text size="xs" c="dimmed">
            {layer.label}
          </Text>
        </Group>
      ))}
    </Group>
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
    <Box>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={8}>
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
      <Group gap="md" mt={8} wrap="wrap">
        {rows.map(({ role, usage, tokens }) => (
          <Group key={role} gap={6}>
            <span
              className={legendSwatchSm}
              style={{ backgroundColor: colorForRole(role) }}
            />
            <Text size="xs" c="dimmed">
              {role} {((tokens / grandTotal) * 100).toFixed(0)}% ·{' '}
              {formatCost(usage.costUsd)}
            </Text>
          </Group>
        ))}
      </Group>
    </Box>
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
      <Box className={stackedBarEmpty} style={{ width, height, opacity }} />
    );
  }

  return (
    <Box className={stackedBar} style={{ width, height, opacity }}>
      {TOKEN_LAYERS.map((layer) => {
        const value = usage[layer.key];
        if (!value) return null;
        const pct = (value / total) * 100;
        return (
          <Box
            key={layer.key}
            className={stackedBarLayer}
            style={{
              height: `${pct}%`,
              minHeight: pct > 0 ? 1 : 0,
              backgroundColor: tokenLayerColor[layer.color],
            }}
          />
        );
      })}
    </Box>
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
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" mb={8}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          Token timeline
        </Text>
        <Text size="xs" c="dimmed">
          width = tokens per call
        </Text>
      </Group>
      <Group gap={2} wrap="nowrap" align="flex-end" className={timelineScroll}>
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
      </Group>
      <Legend />
    </Paper>
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
