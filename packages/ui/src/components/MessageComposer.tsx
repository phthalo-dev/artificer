import { Button, HStack, Text, TextAreaField, toast } from '@var-ui/react';
import { IconSend } from '@tabler/icons-react';
import { useState } from 'react';
import { useSendMessage } from '../api/hooks';
import { CLOUD_MODE } from '../api/client';
import { composerField, composerFooter } from './MessageComposer.styles';

export function MessageComposer() {
  const [content, setContent] = useState('');
  const send = useSendMessage();

  const submit = () => {
    const text = content.trim();
    if (!text) return;
    send.mutate(text, {
      onSuccess: () => {
        setContent('');
        toast({
          title: CLOUD_MODE
            ? 'Message queued — agent will pick it up when ready'
            : 'Message sent to the agent',
          tone: 'success',
        });
      },
      onError: (err) => {
        toast({
          title: 'Failed to send',
          description: err instanceof Error ? err.message : 'Unknown error',
          tone: 'danger',
        });
      },
    });
  };

  return (
    <div>
      <TextAreaField
        aria-label="Message"
        className={composerField}
        placeholder="Message the agent… (e.g. 'Build a CLI calculator', or 'How is project X going?')"
        rows={2}
        value={content}
        onValueChange={setContent}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      />
      <HStack justify="between" className={composerFooter}>
        <Text size="xs" tone="secondary">
          ⌘/Ctrl + Enter to send
        </Text>
        <Button
          tone="accent"
          appearance="filled"
          onClick={submit}
          loading={send.isPending}
          disabled={!content.trim()}
        >
          <IconSend size={16} />
          Send
        </Button>
      </HStack>
    </div>
  );
}
