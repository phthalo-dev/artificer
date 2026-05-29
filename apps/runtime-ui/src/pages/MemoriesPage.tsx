import {
  Anchor,
  Badge,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useMemories } from '../api/hooks';
import type { Memory } from '../api/types';
import { relativeTime } from '../format';

function isUrl(s: string | undefined): s is string {
  return Boolean(s && /^https?:\/\//i.test(s));
}

function MemoryCard({ memory }: { memory: Memory }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Group justify="space-between" mb={4} wrap="nowrap">
        <Text fw={600} lineClamp={1}>
          {memory.title ?? memory.content.slice(0, 60)}
        </Text>
        <Text size="xs" c="dimmed">
          {relativeTime(memory.createdAt)}
        </Text>
      </Group>
      {memory.summary && (
        <Text size="sm" c="dimmed" mb={6}>
          {memory.summary}
        </Text>
      )}
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
        {memory.content}
      </Text>
      <Group gap="xs" mt="sm">
        {memory.tags.map((t) => (
          <Badge key={t} variant="light" radius="sm">
            {t}
          </Badge>
        ))}
        {isUrl(memory.source) ? (
          <Anchor
            href={memory.source}
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
          >
            source
          </Anchor>
        ) : memory.source ? (
          <Text size="xs" c="dimmed">
            source: {memory.source}
          </Text>
        ) : null}
      </Group>
    </Card>
  );
}

export function MemoriesPage() {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 300);
  const { data, isLoading } = useMemories(debounced.trim() || undefined);

  return (
    <Stack gap="lg">
      <Title order={3}>Memories</Title>
      <TextInput
        aria-label="Search memories"
        leftSection={<IconSearch size={16} />}
        placeholder="Search memories…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      {isLoading && <Loader size="sm" />}
      {data?.length === 0 && (
        <Text c="dimmed" size="sm">
          {debounced.trim()
            ? 'No memories match your search.'
            : 'No memories yet. Send the agent a link or some content to teach it something.'}
        </Text>
      )}
      <Stack gap="sm">
        {data?.map((m) => (
          <MemoryCard key={m.id} memory={m} />
        ))}
      </Stack>
    </Stack>
  );
}
