import {
  Alert,
  Anchor,
  Badge,
  type BadgeColor,
  Box,
  Code,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Title,
} from '../ds';
import { IconArrowLeft } from '@tabler/icons-react';
import { Link, useParams } from 'react-router-dom';
import { useBenchRun } from '../api/hooks';
import type { BenchRunDetail, VerifierStatus } from '../api/types';
import {
  BenchTrajectory,
  countSteps,
  peakContext,
} from '../components/BenchTrajectory';
import { BreakdownTable } from '../components/BreakdownTable';
import { TokenSpendByRole } from '../components/TokenSpendChart';
import { ViewRawLink } from '../components/ViewRawLink';
import { formatCost, formatDuration } from '../format';

const VERIFIER_COLOR: Record<VerifierStatus, BadgeColor> = {
  resolved: 'green',
  unresolved: 'red',
  empty_patch: 'orange',
  error: 'red',
  ungraded: 'gray',
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
        {label}
      </Text>
      <Text fz={22} fw={700} lh={1}>
        {value}
      </Text>
    </Box>
  );
}

function VerdictBadge({ run }: { run: BenchRunDetail }) {
  if (run.resolved === true)
    return (
      <Badge color="green" variant="filled" size="lg">
        PASS
      </Badge>
    );
  if (run.resolved === false)
    return (
      <Badge color="red" variant="light" size="lg">
        FAIL
      </Badge>
    );
  return (
    <Badge color="gray" variant="light" size="lg">
      UNGRADED
    </Badge>
  );
}

function PatchView({ patch }: { patch: string }) {
  const lines = patch.split('\n');
  return (
    <Paper p="sm" style={{ overflowX: 'auto' }}>
      <Box
        component="pre"
        style={{
          margin: 0,
          fontSize: 12,
          fontFamily: 'monospace',
          lineHeight: 1.5,
        }}
      >
        {lines.map((line, i) => {
          let color: string | undefined;
          if (line.startsWith('+') && !line.startsWith('+++'))
            color = '#15803d';
          else if (line.startsWith('-') && !line.startsWith('---'))
            color = '#b91c1c';
          else if (line.startsWith('@@')) color = '#2563eb';
          else if (
            line.startsWith('diff ') ||
            line.startsWith('index ') ||
            line.startsWith('+++') ||
            line.startsWith('---')
          )
            color = '#888888';
          return (
            <div key={i} style={{ color, whiteSpace: 'pre-wrap' }}>
              {line || ' '}
            </div>
          );
        })}
      </Box>
    </Paper>
  );
}

export function BenchRunPage() {
  const { instanceId } = useParams();
  const { data, isLoading, error } = useBenchRun(instanceId);

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) {
    return (
      <Alert color="red" title="Could not load benchmark run">
        {error instanceof Error ? error.message : 'Not found'}
      </Alert>
    );
  }

  const usage = data.usage;
  const steps = data.trajectory ? countSteps(data.trajectory) : null;
  const peakCtx = data.trajectory ? peakContext(data.trajectory) : null;

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/bench" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Back to benchmark
        </Group>
      </Anchor>

      <div>
        <Group gap={8} mb={4}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Artificer Runtime
          </Text>
          <Text size="xs" c="dimmed">
            · {data.repo}
          </Text>
        </Group>
        <Group gap="sm" align="center">
          <Title order={2}>{data.modelName ?? 'runtime'}</Title>
          <VerdictBadge run={data} />
          <Badge variant="light" color="gray">
            {data.outcome.replace(/_/g, ' ')}
          </Badge>
        </Group>
        <Text c="dimmed" size="sm" mt={4}>
          task: <Code>{data.instanceId}</Code>
        </Text>
      </div>

      <Paper p="lg">
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 7 }}>
          <Metric label="Steps" value={steps !== null ? String(steps) : '—'} />
          <Metric label="Calls" value={usage ? String(usage.runs) : '—'} />
          <Metric
            label="Cost"
            value={usage ? formatCost(usage.costUsd) : '—'}
          />
          <Metric
            label="Input tok"
            value={usage ? usage.inputTokens.toLocaleString() : '—'}
          />
          <Metric
            label="Output tok"
            value={usage ? usage.outputTokens.toLocaleString() : '—'}
          />
          <Metric
            label="Peak ctx"
            value={peakCtx !== null ? peakCtx.toLocaleString() : '—'}
          />
          <Metric label="Duration" value={formatDuration(data.durationMs)} />
        </SimpleGrid>
      </Paper>

      {data.byRole && Object.keys(data.byRole).length > 0 && (
        <TokenSpendByRole byRole={data.byRole} />
      )}

      <Tabs defaultValue="trajectory" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="trajectory">Trajectory</Tabs.Tab>
          <Tabs.Tab value="verifier">Verifier output</Tabs.Tab>
          <Tabs.Tab value="patch">Model patch</Tabs.Tab>
          <Tabs.Tab value="metrics">Metrics</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="trajectory" pt="md">
          <Group justify="space-between" mb={8}>
            <Group gap="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {data.modelName}
              </Text>
              {usage && (
                <Text size="xs" c="dimmed">
                  · {usage.runs} calls · {formatCost(usage.costUsd)}
                </Text>
              )}
            </Group>
            <ViewRawLink
              data={data}
              filename={`bench-${data.instanceId}.json`}
            />
          </Group>
          {data.trajectory ? (
            <BenchTrajectory tree={data.trajectory} />
          ) : (
            <Alert color="gray">
              No trajectory captured for this instance yet. Re-run{' '}
              <Code>pnpm bench</Code> to record the agent's step-by-step call
              tree.
            </Alert>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="verifier" pt="md">
          <Group gap="sm" mb={8}>
            <Badge color={VERIFIER_COLOR[data.verifier.status]} variant="light">
              {data.verifier.status.replace(/_/g, ' ')}
            </Badge>
            <Text size="sm">{data.verifier.note}</Text>
          </Group>
          <Text size="sm" c="dimmed">
            SWE-bench: <Code>pnpm bench:eval</Code>. DeepSWE:{' '}
            <Code>pnpm bench:eval:deepswe</Code>. Then{' '}
            <Code>pnpm bench:report</Code>.
          </Text>
        </Tabs.Panel>

        <Tabs.Panel value="patch" pt="md">
          {data.patch ? (
            <PatchView patch={data.patch} />
          ) : (
            <Text c="dimmed" size="sm">
              No patch produced ({data.patchBytes} bytes).
            </Text>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="metrics" pt="md">
          <Stack gap="lg">
            <div>
              <Text fw={600} size="sm" mb={6}>
                By role
              </Text>
              <BreakdownTable label="Role" data={data.byRole} />
            </div>
            {data.problemStatement && (
              <div>
                <Text fw={600} size="sm" mb={6}>
                  Problem statement
                </Text>
                <Paper p="sm">
                  <Text
                    size="sm"
                    style={{ whiteSpace: 'pre-wrap' }}
                    lineClamp={20}
                  >
                    {data.problemStatement}
                  </Text>
                </Paper>
              </div>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
