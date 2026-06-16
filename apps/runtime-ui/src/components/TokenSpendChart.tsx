import { Box, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import type { RunRecord, TokenUsage, UsageSummary } from '../api/types';
import { costForRun } from '../cost';
import { formatCost, formatTokens } from '../format';

const ROLE_COLOR: Record<string, string> = {
  communicator: 'grape',
  orchestrator: 'indigo',
  planner: 'blue',
  worker: 'teal',
  reviewer: 'violet',
  librarian: 'orange',
};

const TOKEN_LAYERS = [
  { key: 'inputTokens' as const, label: 'Input', color: 'blue' },
  { key: 'outputTokens' as const, label: 'Output', color: 'teal' },
  { key: 'cacheReadInputTokens' as const, label: 'Cache read', color: 'gray' },
  {
    key: 'cacheCreationInputTokens' as const,
    label: 'Cache write',
    color: 'orange',
  },
];

function roleColor(role: string): string {
  return ROLE_COLOR[role] ?? 'gray';
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
          <Box
            w={10}
            h={10}
            style={{
              borderRadius: 2,
              backgroundColor: `var(--mantine-color-${layer.color}-6)`,
            }}
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
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={8}>
        Token spend by role
      </Text>
      <Box
        style={{
          display: 'flex',
          height: 28,
          borderRadius: 4,
          overflow: 'hidden',
          backgroundColor: 'var(--mantine-color-gray-1)',
        }}
      >
        {rows.map(({ role, usage, tokens }) => {
          const pct = (tokens / grandTotal) * 100;
          return (
            <Tooltip
              key={role}
              label={`${role} · ${formatTokens(tokens)} tok · ${formatCost(usage.costUsd)}`}
              withArrow
            >
              <Box
                style={{
                  width: `${pct}%`,
                  minWidth: pct > 0 ? 4 : 0,
                  height: '100%',
                  backgroundColor: `var(--mantine-color-${roleColor(role)}-6)`,
                  opacity: 0.9,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      <Group gap="md" mt={8} wrap="wrap">
        {rows.map(({ role, usage, tokens }) => (
          <Group key={role} gap={6}>
            <Box
              w={8}
              h={8}
              style={{
                borderRadius: 2,
                backgroundColor: `var(--mantine-color-${roleColor(role)}-6)`,
              }}
            />
            <Text size="xs" c="dimmed">
              {role} {((tokens / grandTotal) * 100).toFixed(0)}% ·{' '}
              {formatCost(usage.costUsd)}
            </Text>
          </Group>
        ))}
      </Group>
    </Paper>
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
      <Box
        style={{
          width,
          height,
          flex: '0 0 auto',
          borderRadius: 2,
          backgroundColor: 'var(--mantine-color-gray-3)',
          opacity,
        }}
      />
    );
  }

  return (
    <Box
      style={{
        width,
        height,
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column-reverse',
        borderRadius: 2,
        overflow: 'hidden',
        opacity,
      }}
    >
      {TOKEN_LAYERS.map((layer) => {
        const value = usage[layer.key];
        if (!value) return null;
        const pct = (value / total) * 100;
        return (
          <Box
            key={layer.key}
            style={{
              height: `${pct}%`,
              minHeight: pct > 0 ? 1 : 0,
              backgroundColor: `var(--mantine-color-${layer.color}-6)`,
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
      <Group
        gap={2}
        wrap="nowrap"
        align="flex-end"
        style={{ overflowX: 'auto', padding: '4px 0' }}
      >
        {runs.map((run, i) => {
          const tokens = totals[i];
          const width =
            tokens === 0
              ? minW
              : minW +
                ((tokens / maxTokens) * (maxW - minW));
          const layers = TOKEN_LAYERS.map((layer) => ({
            ...layer,
            value: run.usage[layer.key],
          })).filter((l) => l.value > 0);

          return (
            <Tooltip
              key={run.id}
              withArrow
              multiline
              label={
                <Stack gap={2}>
                  <Text size="xs">
                    #{i + 1} · {run.role}
                  </Text>
                  <Text size="xs">{formatTokens(tokens)} tokens</Text>
                  {layers.map((l) => (
                    <Text key={l.key} size="xs">
                      {l.label}: {formatTokens(l.value)}
                    </Text>
                  ))}
                  {run.toolCalls.length > 0 && (
                    <Text size="xs">{run.toolCalls.length} tool calls</Text>
                  )}
                </Stack>
              }
            >
              <StackedBar
                usage={run.usage}
                height={40}
                width={width}
                opacity={run.status === 'failed' ? 0.45 : 1}
              />
            </Tooltip>
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
