import { Card, HStack, Stack, Text } from '@var-ui/react';
import { tokenLayerColor } from '../styles/palette';
import type { RunRecord, TokenUsage } from '../api/types';
import { formatTokens } from '../format';
import { eyebrow } from '../styles/shared';
import { totalTokens } from '../utils/usage';
import {
  legendSwatchMd,
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
