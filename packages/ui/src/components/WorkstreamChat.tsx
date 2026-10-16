import { IconSend } from '@tabler/icons-react';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { usePostWorkstreamMessage, useWorkstreamMessages } from '../api/hooks';
import type { Message, RunRecord, WorkstreamStatus } from '../api/types';
import {
  Button,
  Card,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  color,
} from '../ds';
import { formatTime } from '../format';
import { MarkdownContent } from './MarkdownContent';

function Bubble({ message }: { message: Message }) {
  const inbound = message.direction === 'inbound';
  return (
    <Group justify={inbound ? 'flex-end' : 'flex-start'} align="flex-start">
      <Paper p="sm" maw="80%" bg={inbound ? color.blueLight : color.surface}>
        <Group justify="space-between" gap="xs" mb={4}>
          <Text size="xs" c="dimmed" fw={600}>
            {inbound ? 'You' : 'Agent'}
          </Text>
          <Text size="xs" c="dimmed">
            {formatTime(message.createdAt)}
          </Text>
        </Group>
        <MarkdownContent content={message.content} />
      </Paper>
    </Group>
  );
}

export function WorkstreamChat({
  workstreamId,
  status,
  runs,
}: {
  workstreamId: string;
  status: WorkstreamStatus;
  runs: RunRecord[];
}) {
  const messages = useWorkstreamMessages(workstreamId);
  const post = usePostWorkstreamMessage(workstreamId);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const workerBusy = runs.some(
    (run) =>
      run.role === 'worker' &&
      (run.status === 'queued' || run.status === 'running'),
  );
  const disabled = status !== 'in_progress' || workerBusy;

  const submit = () => {
    const text = content.trim();
    if (!text || disabled) return;
    setError(null);
    post.mutate(text, {
      onSuccess: () => setContent(''),
      onError: (err) => {
        if (
          err instanceof ApiError &&
          err.status === 409 &&
          /still working/i.test(err.message)
        ) {
          setError('The agent is still working on the previous message');
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      },
    });
  };

  return (
    <Card padding="md">
      <ScrollArea.Autosize mah="calc(100vh - 320px)" mb="md">
        <Stack gap="sm">
          {messages.isLoading && <Loader size="sm" />}
          {messages.data?.length === 0 && (
            <Text c="dimmed" size="sm">
              No messages yet.
            </Text>
          )}
          {messages.data?.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </Stack>
      </ScrollArea.Autosize>
      <Textarea
        placeholder="Message the agent…"
        autosize
        minRows={2}
        maxRows={6}
        value={content}
        isDisabled={disabled}
        onChange={(event) => setContent(event.currentTarget.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            submit();
          }
        }}
      />
      {error && (
        <Text size="sm" c="red" mt="xs">
          {error}
        </Text>
      )}
      <Group justify="space-between" mt="xs">
        <Text size="xs" c="dimmed">
          {workerBusy
            ? 'The agent is still working on the previous message'
            : '⌘/Ctrl + Enter to send'}
        </Text>
        <Button
          leftSection={<IconSend size={16} />}
          onPress={submit}
          loading={post.isPending}
          isDisabled={disabled || !content.trim()}
        >
          Send
        </Button>
      </Group>
    </Card>
  );
}
