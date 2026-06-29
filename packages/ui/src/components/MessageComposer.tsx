import { Button, Group, Text, Textarea } from '../ds';
import { notifications } from '../ds/notifications';
import { IconSend } from '@tabler/icons-react';
import { useState } from 'react';
import { useSendMessage } from '../api/hooks';
import { CLOUD_MODE } from '../api/client';

export function MessageComposer() {
  const [content, setContent] = useState('');
  const send = useSendMessage();

  const submit = () => {
    const text = content.trim();
    if (!text) return;
    send.mutate(text, {
      onSuccess: () => {
        setContent('');
        notifications.show({
          message: CLOUD_MODE
            ? 'Message queued — agent will pick it up when ready'
            : 'Message sent to the agent',
          color: 'green',
        });
      },
      onError: (err) => {
        notifications.show({
          title: 'Failed to send',
          message: err instanceof Error ? err.message : 'Unknown error',
          color: 'red',
        });
      },
    });
  };

  return (
    <div>
      <Textarea
        placeholder="Message the agent… (e.g. 'Build a CLI calculator', or 'How is project X going?')"
        autosize
        minRows={2}
        maxRows={6}
        value={content}
        onChange={(e) => setContent(e.currentTarget.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      />
      <Group justify="space-between" mt="xs">
        <Text size="xs" c="dimmed">⌘/Ctrl + Enter to send</Text>
        <Button
          leftSection={<IconSend size={16} />}
          onPress={submit}
          loading={send.isPending}
          isDisabled={!content.trim()}
        >
          Send
        </Button>
      </Group>
    </div>
  );
}
