import {
  Card, Group, Loader, Paper, ScrollArea, Stack, Text, Title, color,
} from '../ds';
import { Link } from 'react-router-dom';
import { useMessages } from '../api/hooks';
import { MessageComposer } from '../components/MessageComposer';
import { MarkdownContent } from '../components/MarkdownContent';
import type { Message } from '../api/types';
import { formatTime } from '../format';

function Bubble({ message }: { message: Message }) {
  const inbound = message.direction === 'inbound';
  return (
    <Group justify={inbound ? 'flex-end' : 'flex-start'} align="flex-start">
      <Paper
        p="sm"
        maw="80%"
        bg={inbound ? color.blueLight : color.surface}
      >
        <Group justify="space-between" gap="xs" mb={4}>
          <Text size="xs" c="dimmed" fw={600}>{inbound ? 'You' : 'Agent'}</Text>
          <Text size="xs" c="dimmed">{formatTime(message.createdAt)}</Text>
        </Group>
        <MarkdownContent content={message.content} />
        {message.workstreamId && (
          <Text size="xs" mt={4}>
            <Link to={`/workstreams/${message.workstreamId}`}>View workstream →</Link>
          </Text>
        )}
      </Paper>
    </Group>
  );
}

export function MessagesPage() {
  const messages = useMessages();

  return (
    <Stack gap="lg">
      <Title order={3}>Messages</Title>

      <Card padding="md">
        <ScrollArea.Autosize mah="calc(100vh - 220px)" mb="md">
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
