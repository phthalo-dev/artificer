import {
  Anchor,
  Badge,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useMemories } from '../api/hooks';
import type { Memory } from '../api/types';
import { formatTime, relativeTime } from '../format';

function isUrl(s: string | undefined): s is string {
  return Boolean(s && /^https?:\/\//i.test(s));
}

function SourceLink({ source }: { source?: string }) {
  if (isUrl(source)) {
    return (
      <Anchor
        href={source}
        target="_blank"
        rel="noopener noreferrer"
        size="xs"
        onClick={(e) => e.stopPropagation()}
      >
        source
      </Anchor>
    );
  }
  if (source) {
    return (
      <Text size="xs" c="dimmed">
        source: {source}
      </Text>
    );
  }
  return null;
}

function MemoryCard({
  memory,
  onSelect,
}: {
  memory: Memory;
  onSelect: (m: Memory) => void;
}) {
  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      role="button"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(memory)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(memory);
        }
      }}
    >
      <Group justify="space-between" mb={4} wrap="nowrap">
        <Text fw={600} lineClamp={1}>
          {memory.title ?? memory.content.slice(0, 60)}
        </Text>
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {relativeTime(memory.createdAt)}
        </Text>
      </Group>
      {memory.summary && (
        <Text size="sm" c="dimmed" mb={6}>
          {memory.summary}
        </Text>
      )}
      <Text size="sm" lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>
        {memory.content}
      </Text>
      <Group gap="xs" mt="sm">
        {memory.tags.map((t) => (
          <Badge key={t} variant="light" radius="sm">
            {t}
          </Badge>
        ))}
        <SourceLink source={memory.source} />
      </Group>
    </Card>
  );
}

function MemoryDetail({ memory }: { memory: Memory }) {
  return (
    <Stack gap="sm">
      {memory.summary && (
        <Text size="sm" c="dimmed">
          {memory.summary}
        </Text>
      )}
      <ScrollArea.Autosize mah={420} type="auto">
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {memory.content}
        </Text>
      </ScrollArea.Autosize>
      {memory.tags.length > 0 && (
        <Group gap="xs">
          {memory.tags.map((t) => (
            <Badge key={t} variant="light" radius="sm">
              {t}
            </Badge>
          ))}
        </Group>
      )}
      <Divider />
      <Stack gap={4}>
        {memory.source && (
          <Group gap="xs">
            <Text size="xs" c="dimmed" w={70}>
              Source
            </Text>
            {isUrl(memory.source) ? (
              <Anchor
                href={memory.source}
                target="_blank"
                rel="noopener noreferrer"
                size="xs"
              >
                {memory.source}
              </Anchor>
            ) : (
              <Text size="xs">{memory.source}</Text>
            )}
          </Group>
        )}
        {memory.kind && (
          <Group gap="xs">
            <Text size="xs" c="dimmed" w={70}>
              Kind
            </Text>
            <Text size="xs">{memory.kind}</Text>
          </Group>
        )}
        <Group gap="xs">
          <Text size="xs" c="dimmed" w={70}>
            Created
          </Text>
          <Text size="xs">{formatTime(memory.createdAt)}</Text>
        </Group>
        {memory.updatedAt && memory.updatedAt !== memory.createdAt && (
          <Group gap="xs">
            <Text size="xs" c="dimmed" w={70}>
              Updated
            </Text>
            <Text size="xs">{formatTime(memory.updatedAt)}</Text>
          </Group>
        )}
        <Group gap="xs">
          <Text size="xs" c="dimmed" w={70}>
            ID
          </Text>
          <Code>{memory.id}</Code>
        </Group>
      </Stack>
    </Stack>
  );
}

export function MemoriesPage() {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 300);
  const { data, isLoading } = useMemories(debounced.trim() || undefined);
  const [selected, setSelected] = useState<Memory | null>(null);
  const [opened, { open, close }] = useDisclosure(false);

  const select = (m: Memory) => {
    setSelected(m);
    open();
  };

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
          <MemoryCard key={m.id} memory={m} onSelect={select} />
        ))}
      </Stack>

      <Modal
        opened={opened}
        onClose={close}
        size="lg"
        title={
          <Text fw={600}>
            {selected?.title ?? selected?.content.slice(0, 80) ?? 'Memory'}
          </Text>
        }
      >
        {selected && <MemoryDetail memory={selected} />}
      </Modal>
    </Stack>
  );
}
