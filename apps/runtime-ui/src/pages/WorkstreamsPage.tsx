import { Card, Group, Loader, SimpleGrid, Stack, Text, Title } from '../ds';
import { Link } from 'react-router-dom';
import { useWorkstreams } from '../api/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { relativeTime } from '../format';

export function WorkstreamsPage() {
  const { data, isLoading } = useWorkstreams();

  return (
    <Stack gap="lg">
      <Title order={3}>Workstreams</Title>
      {isLoading && <Loader size="sm" />}
      {data?.length === 0 && (
        <Text c="dimmed" size="sm">
          No workstreams yet. Ask the agent to take on a piece of work from the
          Dashboard.
        </Text>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {data?.map((ws) => (
          <Card
            key={ws.id}
            withBorder
            radius="md"
            padding="md"
            component={Link}
            to={`/workstreams/${ws.id}`}
          >
            <Group justify="space-between" style={{ marginBottom: 'var(--nb-space-xs)' }} wrap="nowrap">
              <Text fw={600} lineClamp={1}>
                {ws.title}
              </Text>
              <StatusBadge status={ws.status} />
            </Group>
            <Text size="sm" c="dimmed" lineClamp={3}>
              {ws.summary || ws.goal}
            </Text>
            <Text size="xs" c="dimmed" mt={8}>
              Updated {relativeTime(ws.updatedAt)}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
