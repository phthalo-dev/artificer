import { Card, HStack, Text, Stack } from '@var-ui/react';
import type { BenchEfficiencyPoint } from '../api/types';
import { formatCost } from '../format';
import { hue } from '../styles/palette';
import { t } from '../styles/system';

const AXIS_TEXT = { fill: t.color.text.secondary.var };
const GRID_LINE = { stroke: t.color.border.subtle.var };

const PAD = { top: 16, right: 16, bottom: 36, left: 48 };
const W = 640;
const H = 280;
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function scale(
  points: BenchEfficiencyPoint[],
  key: 'costUsd' | 'scorePct',
): (v: number) => number {
  const vals = points.map((p) => p[key]);
  const min = Math.min(...vals, key === 'scorePct' ? 0 : 0);
  const max = Math.max(...vals, key === 'scorePct' ? 100 : min + 0.01);
  const span = max - min || 1;
  return (v: number) => {
    if (key === 'scorePct') {
      return PAD.top + PLOT_H - ((v - min) / span) * PLOT_H;
    }
    return PAD.left + ((v - min) / span) * PLOT_W;
  };
}

function pointColor(p: BenchEfficiencyPoint): string {
  if (p.kind === 'run') return p.isCurrent ? hue.blue : hue.gray;
  if (p.resolved === true) return hue.green;
  if (p.resolved === false) return hue.red;
  return hue.gray;
}

export function BenchEfficiencyChart({
  title,
  subtitle,
  points,
  xLabel,
  yLabel,
}: {
  title: string;
  subtitle?: string;
  points: BenchEfficiencyPoint[];
  xLabel: string;
  yLabel: string;
}) {
  if (!points || points.length === 0) {
    return (
      <Card title={title} headingLevel={3}>
        <Text tone="secondary" size="sm">
          No data yet.
        </Text>
      </Card>
    );
  }

  const x = scale(points, 'costUsd');
  const y = scale(points, 'scorePct');
  const maxCost = Math.max(...points.map((p) => p.costUsd), 0.01);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxCost);

  return (
    <Card title={title} headingLevel={3}>
      <Stack gap="sm">
        <HStack justify="between" align="start">
          {subtitle ? (
            <Text size="xs" tone="secondary">
              {subtitle}
            </Text>
          ) : (
            <span />
          )}
          <Text size="xs" tone="secondary">
            most efficient ↗
          </Text>
        </HStack>

        <div style={{ overflowX: 'auto' }}>
          <svg width={W} height={H} role="img" aria-label={title}>
            {[0, 25, 50, 75, 100].map((pct) => {
              const yy = y(pct);
              return (
                <g key={pct}>
                  <line
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={yy}
                    y2={yy}
                    style={GRID_LINE}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={PAD.left - 8}
                    y={yy + 4}
                    textAnchor="end"
                    fontSize={10}
                    style={AXIS_TEXT}
                  >
                    {pct}%
                  </text>
                </g>
              );
            })}

            {ticks.map((tick) => (
              <text
                key={tick}
                x={x(tick)}
                y={H - 8}
                textAnchor="middle"
                fontSize={10}
                style={AXIS_TEXT}
              >
                {formatCost(tick)}
              </text>
            ))}

            <text
              x={W / 2}
              y={H - 0}
              textAnchor="middle"
              fontSize={11}
              style={AXIS_TEXT}
            >
              {xLabel}
            </text>
            <text
              x={12}
              y={H / 2}
              textAnchor="middle"
              fontSize={11}
              style={AXIS_TEXT}
              transform={`rotate(-90 12 ${H / 2})`}
            >
              {yLabel}
            </text>

            {points.map((p) => (
              <g key={p.id}>
                <title>{`${p.label} · ${formatCost(p.costUsd)} · ${p.scorePct}%`}</title>
                <circle
                  cx={x(p.costUsd)}
                  cy={y(p.scorePct)}
                  r={p.isCurrent ? 7 : 5}
                  fill={pointColor(p)}
                  style={{
                    stroke: p.isCurrent
                      ? t.color.text.primary.var
                      : t.color.background.surface.var,
                  }}
                  strokeWidth={p.isCurrent ? 2 : 1}
                />
              </g>
            ))}
          </svg>
        </div>
      </Stack>
    </Card>
  );
}
