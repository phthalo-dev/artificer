import {
  Badge,
  Button,
  Card,
  Code,
  DescriptionList,
  Dialog,
  Divider,
  Heading,
  HStack,
  Link,
  ScrollArea,
  SearchInput,
  Select,
  Spinner,
  Stack,
  Tabs,
  Text,
  TextAreaField,
  TextField,
  useDebouncedValue,
  useDisclosure,
} from '@var-ui/react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import {
  useMemories,
  useCreateMemory,
  useDeleteMemory,
  type CreateMemoryInput,
} from '../api/hooks';
import type { Memory } from '../api/types';
import { MarkdownContent } from '../components/MarkdownContent';
import { formatTime, relativeTime } from '../format';
import { memoryCard, preWrap, scrollPanel } from './MemoriesPage.styles';

function isUrl(s: string | undefined): s is string {
  return Boolean(s && /^https?:\/\//i.test(s));
}

function SourceLink({ source }: { source?: string }) {
  if (isUrl(source)) {
    return (
      <Text as="span" size="xs">
        <Link
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          source
        </Link>
      </Text>
    );
  }
  if (source) {
    return (
      <Text as="span" size="xs" tone="secondary">
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
      className={memoryCard}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(memory)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(memory);
        }
      }}
    >
      <Stack gap="xs">
        <HStack justify="between" gap="sm">
          <Text weight="semibold" lineClamp={1}>
            {memory.title ?? memory.content.slice(0, 60)}
          </Text>
          <Text
            as="span"
            size="xs"
            tone="secondary"
            style={{ whiteSpace: 'nowrap' }}
          >
            {relativeTime(memory.createdAt)}
          </Text>
        </HStack>
        {memory.summary && (
          <Text size="sm" tone="secondary">
            {memory.summary}
          </Text>
        )}
        <Text size="sm" lineClamp={3} className={preWrap}>
          {memory.content}
        </Text>
        <HStack gap="xs" wrap>
          {memory.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          <SourceLink source={memory.source} />
        </HStack>
      </Stack>
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
  const meta: { id: string; label: string; value: ReactNode }[] = [];
  if (memory.source) {
    meta.push({
      id: 'source',
      label: 'Source',
      value: isUrl(memory.source) ? (
        <Link href={memory.source} target="_blank" rel="noopener noreferrer">
          {memory.source}
        </Link>
      ) : (
        memory.source
      ),
    });
  }
  if (memory.kind) {
    meta.push({ id: 'kind', label: 'Kind', value: memory.kind });
  }
  if (memory.related && memory.related.length > 0) {
    meta.push({
      id: 'related',
      label: 'Related',
      value: (
        <Stack gap="xs">
          {memory.related.map((r) => (
            <Text key={`${r.id}:${r.type}`} as="span" size="xs">
              {r.type} → <Code>{r.id}</Code>
            </Text>
          ))}
        </Stack>
      ),
    });
  }
  if (memory.sourceHash) {
    meta.push({
      id: 'hash',
      label: 'Hash',
      value: <Code>{memory.sourceHash.slice(0, 16)}…</Code>,
    });
  }
  if (memory.sourceCommit) {
    meta.push({
      id: 'commit',
      label: 'Commit',
      value: <Code>{memory.sourceCommit.slice(0, 12)}</Code>,
    });
  }
  meta.push({
    id: 'created',
    label: 'Created',
    value: formatTime(memory.createdAt),
  });
  if (memory.updatedAt && memory.updatedAt !== memory.createdAt) {
    meta.push({
      id: 'updated',
      label: 'Updated',
      value: formatTime(memory.updatedAt),
    });
  }
  meta.push({ id: 'id', label: 'ID', value: <Code>{memory.id}</Code> });

  return (
    <Stack gap="sm">
      {memory.summary && (
        <Text size="sm" tone="secondary">
          {memory.summary}
        </Text>
      )}
      <Tabs
        defaultValue="rendered"
        tabs={[
          {
            value: 'rendered',
            label: 'Rendered',
            content: (
              <ScrollArea className={scrollPanel}>
                <MarkdownContent content={memory.content} />
              </ScrollArea>
            ),
          },
          {
            value: 'raw',
            label: 'Raw',
            content: (
              <ScrollArea className={scrollPanel}>
                <Text size="sm" className={preWrap}>
                  {memory.content}
                </Text>
              </ScrollArea>
            ),
          },
        ]}
      />
      {memory.tags.length > 0 && (
        <HStack gap="xs" wrap>
          {memory.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </HStack>
      )}
      <Divider />
      <DescriptionList columns="single" labelPosition="start" items={meta} />
      <Divider />
      <HStack justify="end">
        <Button
          tone="danger"
          appearance="subtle"
          size="sm"
          loading={deleting}
          onClick={onDelete}
        >
          <IconTrash size={14} />
          Delete
        </Button>
      </HStack>
    </Stack>
  );
}

const KIND_OPTIONS = [
  { value: 'note', label: 'Note' },
  { value: 'document', label: 'Document' },
  { value: 'preference', label: 'Preference' },
  { value: 'claim', label: 'Claim' },
  { value: 'entity', label: 'Entity' },
];

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
  }>({
    content: '',
    title: '',
    summary: '',
    tags: '',
    kind: 'note',
    source: '',
  });

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async () => {
    const input: CreateMemoryInput = {
      content: form.content,
      title: form.title || undefined,
      summary: form.summary || undefined,
      tags: form.tags
        ? form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      kind: (form.kind as CreateMemoryInput['kind']) || 'note',
      source: form.source || undefined,
    };
    await createMemory.mutateAsync(input);
    setForm({
      content: '',
      title: '',
      summary: '',
      tags: '',
      kind: 'note',
      source: '',
    });
    onClose();
  };

  return (
    <Dialog open={opened} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Popup>
        <Dialog.Header>
          <Dialog.Title>Add Memory</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        <Stack gap="sm">
          <TextField
            label="Title"
            placeholder="Short label for this memory"
            value={form.title}
            onValueChange={set('title')}
          />
          <TextAreaField
            label="Content (required)"
            required
            placeholder="The memory content…"
            rows={4}
            value={form.content}
            onValueChange={set('content')}
          />
          <TextField
            label="Summary"
            placeholder="One-line gist used for search ranking"
            value={form.summary}
            onValueChange={set('summary')}
          />
          <TextField
            label="Tags"
            placeholder="Comma-separated tags, e.g. style, payments"
            value={form.tags}
            onValueChange={set('tags')}
          />
          <Select
            label="Kind"
            options={KIND_OPTIONS}
            value={form.kind}
            onValueChange={(v) => set('kind')(v ?? 'note')}
          />
          <TextField
            label="Source"
            placeholder="URL or description, e.g. https://… or conversation"
            value={form.source}
            onValueChange={set('source')}
          />
        </Stack>
        <Dialog.Actions>
          <Button appearance="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="accent"
            appearance="filled"
            onClick={handleSubmit}
            loading={createMemory.isPending}
            disabled={!form.content.trim()}
          >
            Save
          </Button>
        </Dialog.Actions>
      </Dialog.Popup>
    </Dialog>
  );
}

export function MemoriesPage() {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);
  const { data, isLoading } = useMemories(debounced.trim() || undefined);
  const [selected, setSelected] = useState<Memory | null>(null);
  const detail = useDisclosure(false);
  const add = useDisclosure(false);
  const deleteMemory = useDeleteMemory();

  const select = (m: Memory) => {
    setSelected(m);
    detail.show();
  };

  const handleDelete = async () => {
    if (!selected) return;
    await deleteMemory.mutateAsync(selected.id);
    detail.hide();
    setSelected(null);
  };

  return (
    <Stack gap="lg">
      <HStack justify="between">
        <Heading level={3} size="md">
          Memories
        </Heading>
        <Button tone="accent" appearance="filled" size="sm" onClick={add.show}>
          <IconPlus size={14} />
          Add Memory
        </Button>
      </HStack>
      <SearchInput
        aria-label="Search memories"
        placeholder="Search memories…"
        value={query}
        onValueChange={setQuery}
      />
      {isLoading && <Spinner size="sm" label="Loading memories…" />}
      {data?.length === 0 && (
        <Text tone="secondary" size="sm">
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

      <Dialog open={detail.open} onOpenChange={detail.setOpen}>
        <Dialog.Popup>
          <Dialog.Header>
            <Dialog.Title>
              {selected?.title ?? selected?.content.slice(0, 80) ?? 'Memory'}
            </Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          {selected && (
            <MemoryDetail
              memory={selected}
              onDelete={handleDelete}
              deleting={deleteMemory.isPending}
            />
          )}
        </Dialog.Popup>
      </Dialog>

      <AddMemoryModal opened={add.open} onClose={add.hide} />
    </Stack>
  );
}
