import {
  Card,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  Heading,
  Link,
  ScrollArea,
  Spinner,
  Stack,
  Text,
} from '@var-ui/react';
import { useMessages } from '../api/hooks';
import { MessageComposer } from '../components/MessageComposer';
import { MarkdownContent } from '../components/MarkdownContent';
import type { Message } from '../api/types';
import { formatTime } from '../format';
import { userBubble } from '../styles/chat';
import { t } from '../styles/system';

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
        {message.workstreamId && (
          <Text size="xs" style={{ marginTop: t.space.xxs.var }}>
            <Link href={`/workstreams/${message.workstreamId}`}>
              View workstream →
            </Link>
          </Text>
        )}
      </ChatMessageBubble>
    </ChatMessage>
  );
}

export function MessagesPage() {
  const messages = useMessages();

  return (
    <Stack gap="lg">
      <Heading level={3} size="md">
        Messages
      </Heading>

      <Card>
        <Stack gap="md">
          <ScrollArea style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {messages.isLoading ? (
              <Spinner size="sm" label="Loading messages" />
            ) : (
              <ChatMessageList
                density="compact"
                emptyState={
                  <Text tone="secondary" size="sm">
                    No messages yet. Say hello to the agent below.
                  </Text>
                }
              >
                {messages.data?.map((m) => (
                  <Bubble key={m.id} message={m} />
                ))}
              </ChatMessageList>
            )}
          </ScrollArea>
          <MessageComposer />
        </Stack>
      </Card>
    </Stack>
  );
}
