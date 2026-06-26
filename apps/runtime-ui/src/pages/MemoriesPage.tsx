import {
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '../ds';
import { useDebouncedValue, useDisclosure } from '../ds/hooks';
import { IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useMemories, useCreateMemory, useDeleteMemory, type CreateMemoryInput } from '../api/hooks';
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
      <Group justify="space-between" style={{ marginBottom: 4 }} wrap="nowrap">
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
      <Group gap="xs" style={{ marginTop: 8 }}>
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

function MemoryDetail({
  memory,
  onDelete,
  deleting,
}: {
  memory: Memory;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Stack gap="sm">
      {memory.summary && (
        <Text size="sm" c="dimmed">
          {memory.summary}
        </Text>
      )}
      <ScrollArea.Autosize mah={420}>
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
      <Divider />
      <Group justify="flex-end">
        <Button
          variant="light"
          leftSection={<IconTrash size={14} />}
          size="xs"
          loading={deleting}
          onClick={onDelete}
          style={{ color: 'var(--color-error, #c00)' }}
        >
          Delete
        </Button>
      </Group>
    </Stack>
  );
}

function AddMemoryModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const createMemory = useCreateMemory();
  const [form, setForm] = useState<{
    content: string;
    title: string;
    summary: string;
    tags: string;
    kind: string;
    source: string;
  }>({ content: '', title: '', summary: '', tags: '', kind: 'note', source: '' });

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async () => {
    const input: CreateMemoryInput = {
      content: form.content,
      title: form.title || undefined,
      summary: form.summary || undefined,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      kind: (form.kind as CreateMemoryInput['kind']) || 'note',
      source: form.source || undefined,
    };
    await createMemory.mutateAsync(input);
    setForm({ content: '', title: '', summary: '', tags: '', kind: 'note', source: '' });
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={600}>Add Memory</Text>} size="lg">
      <Stack gap="sm">
        <TextInput
          label="Title"
          placeholder="Short label for this memory"
          value={form.title}
          onChange={set('title')}
        />
        <Stack gap={4}>
          <Text size="sm" fw={600}>Content <Text c="dimmed">(required)</Text></Text>
          <Textarea
            placeholder="The memory content…"
            autosize
            minRows={4}
            value={form.content}
            onChange={(e) => set('content')(e.currentTarget.value)}
          />
        </Stack>
        <TextInput
          label="Summary"
          placeholder="One-line gist used for search ranking"
          value={form.summary}
          onChange={set('summary')}
        />
        <TextInput
          label="Tags"
          placeholder="Comma-separated tags, e.g. style, payments"
          value={form.tags}
          onChange={set('tags')}
        />
        <Select
          label="Kind"
          data={[
            { value: 'note', label: 'Note' },
            { value: 'document', label: 'Document' },
            { value: 'preference', label: 'Preference' },
          ]}
          value={form.kind}
          onChange={(v) => set('kind')(v ?? 'note')}
        />
        <TextInput
          label="Source"
          placeholder="URL or description, e.g. https://… or conversation"
          value={form.source}
          onChange={set('source')}
        />
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={createMemory.isPending}
            isDisabled={!form.content.trim()}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function MemoriesPage() {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 300);
  const { data, isLoading } = useMemories(debounced.trim() || undefined);
  const [selected, setSelected] = useState<Memory | null>(null);
  const [detailOpened, { open: openDetail, close: closeDetail }] = useDisclosure(false);
  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
  const deleteMemory = useDeleteMemory();

  const select = (m: Memory) => {
    setSelected(m);
    openDetail();
  };

  const handleDelete = async () => {
    if (!selected) return;
    await deleteMemory.mutateAsync(selected.id);
    closeDetail();
    setSelected(null);
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Memories</Title>
        <Button
          leftSection={<IconPlus size={14} />}
          size="xs"
          onClick={openAdd}
        >
          Add Memory
        </Button>
      </Group>
      <TextInput
        aria-label="Search memories"
        leftSection={<IconSearch size={16} />}
        placeholder="Search memories…"
        value={query}
        onChange={(value) => setQuery(value)}
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
        opened={detailOpened}
        onClose={closeDetail}
        size="lg"
        title={
          <Text fw={600}>
            {selected?.title ?? selected?.content.slice(0, 80) ?? 'Memory'}
          </Text>
        }
      >
        {selected && (
          <MemoryDetail
            memory={selected}
            onDelete={handleDelete}
            deleting={deleteMemory.isPending}
          />
        )}
      </Modal>

      <AddMemoryModal opened={addOpened} onClose={closeAdd} />
    </Stack>
  );
}
