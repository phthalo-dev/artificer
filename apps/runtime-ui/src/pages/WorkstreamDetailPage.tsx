import {
  Alert,
  Anchor,
  Badge,
  Box,
  Card,
  Code,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { Link, useParams } from 'react-router-dom';
import { useWorkstream } from '../api/hooks';
import type { ReviewSeverity, RunRecord, Workstream } from '../api/types';
import {
  BenchTrajectory,
  countSteps,
  flattenRuns,
  peakContext,
} from '../components/BenchTrajectory';
import { BreakdownTable } from '../components/BreakdownTable';
import { StatusBadge } from '../components/StatusBadge';
import { TokenSpendByRole } from '../components/TokenSpendChart';
import { ViewRawLink } from '../components/ViewRawLink';
import { formatCost, formatDuration, formatTime } from '../format';

const SEVERITY_COLORS: Record<ReviewSeverity, string> = {
  critical: 'red',
  important: 'orange',
  minor: 'yellow',
  none: 'green',
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

function workstreamDurationMs(ws: Workstream, runs: RunRecord[]): number {
  if (runs.length === 0) {
    return new Date(ws.updatedAt).getTime() - new Date(ws.createdAt).getTime();
  }
  const starts = runs.map((r) =>
    new Date(r.startedAt ?? r.createdAt).getTime(),
  );
  const ends = runs.map((r) =>
    new Date(r.finishedAt ?? r.createdAt).getTime(),
  );
  return Math.max(...ends) - Math.min(...starts);
}

function primaryModel(runs: RunRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (!run.model) continue;
    counts.set(run.model, (counts.get(run.model) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

export function WorkstreamDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useWorkstream(id);

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) {
    return (
      <Alert color="red" title="Could not load workstream">
        {error instanceof Error ? error.message : 'Not found'}
      </Alert>
    );
  }

  const { workstream: ws, tasks, reviews, plan, tree, usage } = data;
  const runs = flattenRuns(tree);
  const steps = countSteps(tree);
  const peakCtx = peakContext(tree);
  const durationMs = workstreamDurationMs(ws, data.runs);
  const model = primaryModel(data.runs);

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/workstreams" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Back to workstreams
        </Group>
      </Anchor>

      <div>
        <Group gap={8} mb={4}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Artificer Runtime
          </Text>
          <Text size="xs" c="dimmed">
            · workstream
          </Text>
          <Text size="xs" c="dimmed">
            · <Code style={{ fontSize: 11 }}>{ws.id}</Code>
          </Text>
        </Group>
        <Group gap="sm" align="center">
          <Title order={2}>{ws.title}</Title>
          <StatusBadge status={ws.status} />
        </Group>
        <Text c="dimmed" size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
          {ws.goal}
        </Text>
        {ws.repoUrl && (
          <Text size="sm" mt={4}>
            repo: <Code>{ws.repoUrl}</Code>
          </Text>
        )}
      </div>

      <Paper withBorder radius="md" p="lg">
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 7 }} spacing="xl">
          <Metric label="Steps" value={String(steps)} />
          <Metric label="Calls" value={String(usage.total.runs)} />
          <Metric label="Cost" value={formatCost(usage.total.costUsd)} />
          <Metric
            label="Input tok"
            value={usage.total.inputTokens.toLocaleString()}
          />
          <Metric
            label="Output tok"
            value={usage.total.outputTokens.toLocaleString()}
          />
          <Metric
            label="Peak ctx"
            value={peakCtx > 0 ? peakCtx.toLocaleString() : '—'}
          />
          <Metric label="Duration" value={formatDuration(durationMs)} />
        </SimpleGrid>
      </Paper>

      {runs.length > 0 && <TokenSpendByRole byRole={usage.byRole} />}

      {ws.summary && (
        <Card withBorder radius="md" padding="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
            Summary
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {ws.summary}
          </Text>
        </Card>
      )}

      <Tabs defaultValue="trajectory" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="trajectory">Trajectory</Tabs.Tab>
          <Tabs.Tab value="plan">Plan</Tabs.Tab>
          <Tabs.Tab value="tasks">Tasks</Tabs.Tab>
          <Tabs.Tab value="reviews">Reviews</Tabs.Tab>
          <Tabs.Tab value="metrics">Metrics</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="trajectory" pt="md">
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {model ?? 'sub-agents'}
              </Text>
              <Text size="xs" c="dimmed">
                · {usage.total.runs} calls · {formatCost(usage.total.costUsd)}
              </Text>
            </Group>
            <ViewRawLink
              data={{ workstream: ws, tasks, reviews, plan, tree, usage }}
              filename={`workstream-${ws.id}.json`}
            />
          </Group>
          {runs.length > 0 ? (
            <BenchTrajectory tree={tree} />
          ) : (
            <Alert color="gray" variant="light">
              No agent calls recorded for this workstream yet.
            </Alert>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="plan" pt="md">
          {plan ? (
            <Paper withBorder radius="md" p="sm">
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {plan}
              </Text>
            </Paper>
          ) : (
            <Text c="dimmed" size="sm">
              No plan yet.
            </Text>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="tasks" pt="md">
          {tasks.length === 0 ? (
            <Text c="dimmed" size="sm">
              No tasks yet.
            </Text>
          ) : (
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th>Result</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tasks.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {t.role}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={t.status} />
                    </Table.Td>
                    <Table.Td maw={320}>
                      <Text size="sm">{t.description}</Text>
                    </Table.Td>
                    <Table.Td maw={320}>
                      <Text size="sm" c="dimmed" lineClamp={3}>
                        {t.result ?? '—'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="reviews" pt="md">
          {reviews.length === 0 ? (
            <Text c="dimmed" size="sm">
              No reviews yet.
            </Text>
          ) : (
            <Stack gap="sm">
              {reviews.map((r) => (
                <Card key={r.id} withBorder radius="md" padding="sm">
                  <Group justify="space-between" mb={4}>
                    <Group gap="xs">
                      <Text size="sm" fw={600}>
                        {r.target}
                      </Text>
                      {r.stage ? (
                        <Badge color="gray" variant="light" size="sm">
                          {r.stage}
                        </Badge>
                      ) : null}
                    </Group>
                    <Group gap="xs">
                      {r.severity && r.severity !== 'none' ? (
                        <Badge
                          color={SEVERITY_COLORS[r.severity]}
                          variant="light"
                          size="sm"
                        >
                          {r.severity}
                        </Badge>
                      ) : null}
                      <Badge
                        color={r.approved ? 'green' : 'orange'}
                        variant="light"
                      >
                        {r.approved ? 'approved' : 'changes requested'}
                      </Badge>
                    </Group>
                  </Group>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {r.notes}
                  </Text>
                  <Text size="xs" c="dimmed" mt={4}>
                    {formatTime(r.createdAt)}
                  </Text>
                </Card>
              ))}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="metrics" pt="md">
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              <Metric
                label="Requests"
                value={String(usage.total.requests)}
              />
              <Metric
                label="Cache read"
                value={usage.total.cacheReadInputTokens.toLocaleString()}
              />
              <Metric
                label="Cache write"
                value={usage.total.cacheCreationInputTokens.toLocaleString()}
              />
              <Metric
                label="Updated"
                value={formatTime(ws.updatedAt)}
              />
            </SimpleGrid>
            <div>
              <Text fw={600} size="sm" mb={6}>
                By role
              </Text>
              <BreakdownTable label="Role" data={usage.byRole} />
            </div>
            <div>
              <Text fw={600} size="sm" mb={6}>
                By task
              </Text>
              <BreakdownTable label="Task" data={usage.byTask} />
            </div>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
