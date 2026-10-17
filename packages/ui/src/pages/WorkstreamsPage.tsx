import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '../ds';
import { useDisclosure } from '../ds/hooks';
import { IconPlus } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useWorkstreams } from '../api/hooks';
import { NewWorkstreamModal } from '../components/NewWorkstreamModal';
import { StatusBadge } from '../components/StatusBadge';
import { relativeTime } from '../format';

export function WorkstreamsPage() {
  const { data, isLoading } = useWorkstreams();
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Workstreams</Title>
        <Button leftSection={<IconPlus size={14} />} size="xs" onPress={open}>
          New workstream
        </Button>
      </Group>
      {isLoading && <Loader size="sm" />}
      {data?.length === 0 && (
        <Text c="dimmed" size="sm">
          No workstreams yet. Start a chat here, or ask the agent from Messages.
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
            <Group justify="space-between" mb="xs" wrap="nowrap">
              <Text fw={600} lineClamp={1}>
                {ws.title}
              </Text>
              <StatusBadge status={ws.status} />
            </Group>
            <Text size="sm" c="dimmed" lineClamp={3}>
              {ws.summary || ws.goal}
            </Text>
            <Group justify="space-between" mt={8}>
              <Group gap="xs">
                <Badge size="sm" variant="light">
                  {ws.driver === 'conversation' ? 'Chat' : 'Machine'}
                </Badge>
                {ws.repoId && (
                  <Text size="xs" c="dimmed">
                    {ws.repoId}
                  </Text>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                Updated {relativeTime(ws.updatedAt)}
              </Text>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
      <NewWorkstreamModal opened={opened} onClose={close} />
    </Stack>
  );
}
