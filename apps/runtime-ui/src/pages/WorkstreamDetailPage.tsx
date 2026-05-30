import {
  Alert,
  Anchor,
  Badge,
  Card,
  Code,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { Link, useParams } from 'react-router-dom';
import { useWorkstream } from '../api/hooks';
import type { ReviewSeverity } from '../api/types';
import { BreakdownTable } from '../components/BreakdownTable';
import { RunsTable } from '../components/RunsTable';
import { StatusBadge } from '../components/StatusBadge';
import { UsageStats } from '../components/UsageStats';
import { formatTime } from '../format';

const SEVERITY_COLORS: Record<ReviewSeverity, string> = {
  critical: 'red',
  important: 'orange',
  minor: 'yellow',
  none: 'green',
};

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

  const { workstream: ws, tasks, reviews, plan, runs, usage } = data;

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/workstreams" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Back to workstreams
        </Group>
      </Anchor>

      <div>
        <Group gap="sm">
          <Title order={3}>{ws.title}</Title>
          <StatusBadge status={ws.status} />
        </Group>
        <Text c="dimmed" size="sm" mt={4}>
          {ws.goal}
        </Text>
        {ws.repoUrl && (
          <Text size="sm" mt={4}>
            Repo: <Code>{ws.repoUrl}</Code>
          </Text>
        )}
      </div>

      {ws.summary && (
        <Card withBorder radius="md" padding="md">
          <Title order={5} mb="xs">
            Summary
          </Title>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {ws.summary}
          </Text>
        </Card>
      )}

      <div>
        <Title order={5} mb="sm">
          Usage
        </Title>
        <UsageStats usage={usage.total} />
        <Group align="flex-start" grow mt="md" wrap="wrap">
          <div>
            <Text fw={600} size="sm" mb={4}>
              By role
            </Text>
            <BreakdownTable label="Role" data={usage.byRole} />
          </div>
          <div>
            <Text fw={600} size="sm" mb={4}>
              By task
            </Text>
            <BreakdownTable label="Task" data={usage.byTask} />
          </div>
        </Group>
      </div>

      {plan && (
        <Card withBorder radius="md" padding="md">
          <Title order={5} mb="xs">
            Plan
          </Title>
          <Code block style={{ whiteSpace: 'pre-wrap' }}>
            {plan}
          </Code>
        </Card>
      )}

      <div>
        <Title order={5} mb="sm">
          Tasks
        </Title>
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
      </div>

      <div>
        <Title order={5} mb="sm">
          Reviews
        </Title>
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
                    <Badge color={r.approved ? 'green' : 'orange'} variant="light">
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
      </div>

      <div>
        <Title order={5} mb="sm">
          Runs
        </Title>
        <RunsTable runs={runs} />
      </div>
    </Stack>
  );
}
