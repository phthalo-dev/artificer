import {
  Alert,
  Anchor,
  Badge,
  Card,
  Code,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '../ds';
import { IconFlask } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useBenchRuns, useBenchSuites } from '../api/hooks';
import type { BenchInstanceSummary } from '../api/types';
import { BenchEfficiencyChart } from '../components/BenchEfficiencyChart';
import { formatCost, formatDuration, formatTokensShort } from '../format';

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Paper p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
        {label}
      </Text>
      <Text size="xl" fw={700} lh={1.1}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed" mt={2}>
          {sub}
        </Text>
      )}
    </Paper>
  );
}

function Verdict({ row }: { row: BenchInstanceSummary }) {
  if (row.resolved === true)
    return (
      <Badge color="green" variant="filled">
        PASS
      </Badge>
    );
  if (row.resolved === false)
    return (
      <Badge color="red" variant="light">
        FAIL
      </Badge>
    );
  return (
    <Badge color="gray" variant="light">
      ungraded
    </Badge>
  );
}

export function BenchPage() {
  const { data, isLoading, error } = useBenchRuns();
  const { data: suites } = useBenchSuites();

  if (isLoading) return <Loader size="sm" />;

  if (error || !data) {
    return (
      <Stack gap="md">
        <Title order={3}>Benchmark</Title>
        <Alert color="gray" title="No benchmark results yet" icon={<IconFlask size={18} />}>
          Run a suite from <Code>packages/runtime</Code>:
          <Stack gap={6} mt={4}>
            {(suites ?? [
              {
                id: 'mini-suite',
                runCommand: 'pnpm bench --suite tasks/mini-suite.json',
                evalCommand: 'pnpm bench:eval',
                name: 'SWE-bench Lite mini',
                kind: 'swebench' as const,
                taskCount: 6,
              },
              {
                id: 'deepswe-mini-suite',
                runCommand: 'pnpm bench --suite tasks/deepswe-mini-suite.json',
                evalCommand: 'pnpm bench:eval:deepswe',
                name: 'DeepSWE mini',
                kind: 'deepswe' as const,
                taskCount: 6,
              },
            ]).map((s) => (
              <Text key={s.id} ff="monospace" size="sm">
                {s.runCommand}
              </Text>
            ))}
          </Stack>
        </Alert>
      </Stack>
    );
  }

  const { summary, instances, models, modelName, graded, suiteKind, suiteName } =
    data;
  const passPct =
    summary.resolveRate !== null ? Math.round(summary.resolveRate * 100) : null;

  return (
    <Stack gap="lg">
      <div>
        <Group gap="sm" align="center">
          <Title order={3}>Benchmark</Title>
          {suiteKind && (
            <Badge variant="light" color={suiteKind === 'deepswe' ? 'violet' : 'teal'}>
              {suiteKind === 'deepswe' ? 'DeepSWE' : 'SWE-bench'}
            </Badge>
          )}
          {modelName && (
            <Badge variant="light" color="blue">
              {modelName}
            </Badge>
          )}
        </Group>
        {suiteName && (
          <Text size="sm" c="dimmed" mt={4}>
            {suiteName}
            {data.suiteDescription ? ` — ${data.suiteDescription}` : ''}
          </Text>
        )}
        {models && (
          <Group gap="xs" mt={6}>
            <Text size="xs" c="dimmed">
              tiers:
            </Text>
            <Badge size="sm" variant="outline" color="gray">
              low · {models.low}
            </Badge>
            <Badge size="sm" variant="outline" color="gray">
              medium · {models.medium}
            </Badge>
            <Badge size="sm" variant="outline" color="gray">
              high · {models.high}
            </Badge>
          </Group>
        )}
      </div>

      {suites && suites.length > 0 && (
        <Card padding="md">
          <Text fw={600} size="sm" mb="xs">
            Available suites
          </Text>
          <Stack gap="sm">
            {suites.map((s) => (
              <Group key={s.id} justify="space-between" align="flex-start" wrap="wrap">
                <div>
                  <Group gap="xs">
                    <Text size="sm" fw={600}>
                      {s.name}
                    </Text>
                    <Badge size="xs" variant="outline">
                      {s.kind}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {s.taskCount} tasks
                    </Text>
                  </Group>
                  {s.description && (
                    <Text size="xs" c="dimmed" mt={2}>
                      {s.description}
                    </Text>
                  )}
                </div>
                <Stack gap={2} align="flex-end">
                  <Code style={{ fontSize: 11 }}>{s.runCommand}</Code>
                  <Code style={{ fontSize: 11 }}>{s.evalCommand}</Code>
                </Stack>
              </Group>
            ))}
          </Stack>
        </Card>
      )}

      <Card padding="lg">
        <Group justify="space-between" align="flex-end" mb="sm">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Pass@1
            </Text>
            <Text fz={40} fw={800} lh={1}>
              {passPct !== null ? `${passPct}%` : '—'}
            </Text>
          </div>
          <Text size="sm" c="dimmed">
            {graded
              ? `${summary.resolved}/${summary.instances} resolved`
              : 'not yet graded'}
          </Text>
        </Group>
        <Progress
          value={passPct ?? 0}
          color={passPct && passPct >= 50 ? 'green' : 'blue'}
          size="lg"
        />
      </Card>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <BenchEfficiencyChart
          title="Score vs. cost per run"
          subtitle="Archived benchmark runs (avg cost per instance vs pass rate)"
          points={data.runEfficiency ?? []}
          xLabel="Avg cost per instance"
          yLabel="Pass@1"
        />
        <BenchEfficiencyChart
          title="Score vs. cost per instance"
          subtitle="Current run — green pass, red fail"
          points={data.instanceEfficiency ?? []}
          xLabel="Instance cost"
          yLabel="Pass / fail"
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
        <Stat label="Instances" value={String(summary.instances)} />
        <Stat label="Total cost" value={formatCost(summary.totalCostUsd)} />
        <Stat
          label="Avg cost"
          value={formatCost(summary.avgCostUsd)}
        />
        <Stat
          label="Cost / solved"
          value={
            summary.costPerSolvedUsd !== null
              ? formatCost(summary.costPerSolvedUsd)
              : 'n/a'
          }
        />
        <Stat label="LLM calls" value={String(summary.totalRuns)} />
        <Stat
          label="Tokens"
          value={formatTokensShort(summary.inputTokens)}
          sub={`${formatTokensShort(summary.outputTokens)} out`}
        />
      </SimpleGrid>

      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Verdict</Table.Th>
              <Table.Th>Instance</Table.Th>
              <Table.Th>Repo</Table.Th>
              <Table.Th>Outcome</Table.Th>
              <Table.Th ta="right">Time</Table.Th>
              <Table.Th ta="right">Cost</Table.Th>
              <Table.Th ta="right">Calls</Table.Th>
              <Table.Th ta="right">Out tok</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {instances.map((row) => (
              <Table.Tr key={row.instanceId}>
                <Table.Td>
                  <Verdict row={row} />
                </Table.Td>
                <Table.Td>
                  <Anchor
                    component={Link}
                    to={`/bench/${encodeURIComponent(row.instanceId)}`}
                    size="sm"
                  >
                    {row.instanceId}
                  </Anchor>
                  {row.hasTrajectory && (
                    <Badge size="xs" variant="dot" color="cyan" ml={6}>
                      trajectory
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {row.repo}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{row.outcome.replace(/_/g, ' ')}</Text>
                </Table.Td>
                <Table.Td ta="right">{formatDuration(row.durationMs)}</Table.Td>
                <Table.Td ta="right">{formatCost(row.costUsd)}</Table.Td>
                <Table.Td ta="right">{row.runs}</Table.Td>
                <Table.Td ta="right">
                  {formatTokensShort(row.outputTokens)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
