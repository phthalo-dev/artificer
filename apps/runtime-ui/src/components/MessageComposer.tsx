import { Button, Group, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSend } from '@tabler/icons-react';
import { useState } from 'react';
import { useSendMessage } from '../api/hooks';

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
          message: 'Message sent to the agent',
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
        <span style={{ fontSize: 12, opacity: 0.6 }}>⌘/Ctrl + Enter to send</span>
        <Button
          leftSection={<IconSend size={16} />}
          onClick={submit}
          loading={send.isPending}
          disabled={!content.trim()}
        >
          Send
        </Button>
      </Group>
    </div>
  );
}
