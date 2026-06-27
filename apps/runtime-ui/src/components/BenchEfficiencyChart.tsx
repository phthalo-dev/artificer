import { Box, Group, Paper, Text } from '../ds';
import type { BenchEfficiencyPoint } from '../api/types';
import { formatCost } from '../format';

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
  if (p.kind === 'run')
    return p.isCurrent ? '#2563eb' : '#6b7280';
  if (p.resolved === true) return '#16a34a';
  if (p.resolved === false) return '#ef4444';
  return '#9ca3af';
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
      <Paper p="md">
        <Text fw={600} size="sm">
          {title}
        </Text>
        <Text c="dimmed" size="sm" mt={4}>
          No data yet.
        </Text>
      </Paper>
    );
  }

  const x = scale(points, 'costUsd');
  const y = scale(points, 'scorePct');
  const maxCost = Math.max(...points.map((p) => p.costUsd), 0.01);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxCost);

  return (
    <Paper p="md">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Text fw={600} size="sm">
            {title}
          </Text>
          {subtitle && (
            <Text size="xs" c="dimmed" mt={2}>
              {subtitle}
            </Text>
          )}
        </div>
        <Text size="xs" c="dimmed" ta="right">
          most efficient ↗
        </Text>
      </Group>

      <Box style={{ overflowX: 'auto' }}>
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
                  stroke="#e5e7eb"
                  strokeDasharray="4 4"
                />
                <text
                  x={PAD.left - 8}
                  y={yy + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="#888888"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          {ticks.map((t) => (
            <text
              key={t}
              x={x(t)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="#888888"
            >
              {formatCost(t)}
            </text>
          ))}

          <text
            x={W / 2}
            y={H - 0}
            textAnchor="middle"
            fontSize={11}
            fill="#888888"
          >
            {xLabel}
          </text>
          <text
            x={12}
            y={H / 2}
            textAnchor="middle"
            fontSize={11}
            fill="#888888"
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
                stroke={p.isCurrent ? '#1e40af' : 'white'}
                strokeWidth={p.isCurrent ? 2 : 1}
              />
            </g>
          ))}
        </svg>
      </Box>
    </Paper>
  );
}
