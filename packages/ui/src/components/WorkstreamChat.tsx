import { IconSend } from '@tabler/icons-react';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { usePostWorkstreamMessage, useWorkstreamMessages } from '../api/hooks';
import type { Message, RunRecord, WorkstreamStatus } from '../api/types';
import {
  Button,
  Card,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  HStack,
  Spinner,
  Stack,
  Text,
  TextAreaField,
} from '@var-ui/react';
import { formatTime } from '../format';
import { userBubble } from '../styles/chat';
import { MarkdownContent } from './MarkdownContent';
import { chatLayout } from './Workstream.styles';

function Bubble({ message }: { message: Message }) {
  const inbound = message.direction === 'inbound';
  return (
    <ChatMessage
      sender={inbound ? 'user' : 'assistant'}
      name={inbound ? 'You' : 'Agent'}
      metadata={formatTime(message.createdAt)}
    >
      <ChatMessageBubble className={inbound ? userBubble : undefined}>
        <MarkdownContent content={message.content} />
      </ChatMessageBubble>
    </ChatMessage>
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
    <Card>
      <ChatLayout
        className={chatLayout}
        composer={
          <Stack gap="xs">
            <TextAreaField
              aria-label="Message the agent"
              placeholder="Message the agent…"
              rows={2}
              value={content}
              disabled={disabled}
              onValueChange={setContent}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  submit();
                }
              }}
            />
            {error && (
              <Text size="sm" tone="danger">
                {error}
              </Text>
            )}
            <HStack justify="between">
              <Text size="xs" tone="secondary">
                {workerBusy
                  ? 'The agent is still working on the previous message'
                  : '⌘/Ctrl + Enter to send'}
              </Text>
              <Button
                tone="accent"
                appearance="filled"
                onClick={submit}
                loading={post.isPending}
                disabled={disabled || !content.trim()}
              >
                <IconSend size={16} />
                Send
              </Button>
            </HStack>
          </Stack>
        }
      >
        {messages.isLoading ? (
          <Spinner size="sm" label="Loading messages" />
        ) : (
          <ChatMessageList
            emptyState={
              <Text tone="secondary" size="sm">
                No messages yet.
              </Text>
            }
          >
            {messages.data?.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
          </ChatMessageList>
        )}
      </ChatLayout>
    </Card>
  );
}
