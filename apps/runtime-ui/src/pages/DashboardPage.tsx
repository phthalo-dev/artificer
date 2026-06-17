import {
  Badge, Card, Group, Loader, Paper, ScrollArea, Stack, Text, Title,
} from '../ds';
import { Link } from 'react-router-dom';
import { useMessages, useRuntimeState, useUsage } from '../api/hooks';
import { CLOUD_MODE } from '../api/client';
import { MessageComposer } from '../components/MessageComposer';
import { UsageStats } from '../components/UsageStats';
import type { Message } from '../api/types';
import { formatTime } from '../format';

function Bubble({ message }: { message: Message }) {
  const inbound = message.direction === 'inbound';
  return (
    <Group justify={inbound ? 'flex-end' : 'flex-start'} align="flex-start">
      <Paper
        p="sm"
        maw="80%"
        bg={inbound ? '#dbeafe' : undefined}
      >
        <Group justify="space-between" gap="xs" mb={4}>
          <Text size="xs" c="dimmed" fw={600}>{inbound ? 'You' : 'Agent'}</Text>
          <Text size="xs" c="dimmed">{formatTime(message.createdAt)}</Text>
        </Group>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{message.content}</Text>
        {message.workstreamId && (
          <Text size="xs" mt={4}>
            <Link to={`/workstreams/${message.workstreamId}`}>View workstream →</Link>
          </Text>
        )}
      </Paper>
    </Group>
  );
}

export function DashboardPage() {
  const state = useRuntimeState();
  const messages = useMessages();
  const usage = useUsage();

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>Dashboard</Title>
        <Group gap="xs" style={{ marginTop: 4 }}>
          {state.isError ? (
            <Badge variant="light" color="orange">{CLOUD_MODE ? 'hibernating or starting' : 'offline'}</Badge>
          ) : (
            <Badge variant="light" color={state.data?.busy ? 'blue' : 'gray'}>{state.data?.busy ? 'working' : 'idle'}</Badge>
          )}
          <Badge variant="light">{state.data?.queue.running ?? 0} running</Badge>
          <Badge variant="light">{state.data?.queue.pending ?? 0} queued</Badge>
          <Badge variant="light">{state.data?.activeRuns.length ?? 0} active calls</Badge>
        </Group>
      </div>

      {usage.data && (
        <div>
          <Text fw={600} mb={8}>Total usage</Text>
          <UsageStats usage={usage.data.total} />
        </div>
      )}

      <Card padding="md">
        <Title order={5} style={{ marginBottom: 'var(--nb-space-sm)' }}>Conversation</Title>
        <ScrollArea.Autosize mah={420} style={{ marginBottom: 'var(--nb-space-md)' }}>
          <Stack gap="sm">
            {messages.isLoading && <Loader size="sm" />}
            {messages.data?.length === 0 && (
              <Text c="dimmed" size="sm">No messages yet. Say hello to the agent below.</Text>
            )}
            {messages.data?.map((m) => (<Bubble key={m.id} message={m} />))}
          </Stack>
        </ScrollArea.Autosize>
        <MessageComposer />
      </Card>
    </Stack>
  );
}
