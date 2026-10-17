import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCreateWorkstream,
  useRepos,
  type CreateWorkstreamInput,
} from '../api/hooks';
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '../ds';

type AgentChoice = 'instance' | 'llm' | 'claude-code' | 'cursor-agent';

export function NewWorkstreamModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const repos = useRepos();
  const create = useCreateWorkstream();
  const [title, setTitle] = useState('');
  const [repoId, setRepoId] = useState('');
  const [agent, setAgent] = useState<AgentChoice>('instance');
  const [goal, setGoal] = useState('');
  const [message, setMessage] = useState('');

  const repoOptions =
    repos.data?.map((repo) => ({
      value: repo.id,
      label: `${repo.id} — ${repo.url}`,
    })) ?? [];
  const disabled =
    !title.trim() ||
    !goal.trim() ||
    !repoId ||
    repoOptions.length === 0 ||
    Boolean(repos.error);

  const submit = async () => {
    const input: CreateWorkstreamInput = {
      driver: 'conversation',
      title: title.trim(),
      goal: goal.trim(),
      repoId,
      ...(agent === 'instance' ? {} : { executor: agent }),
      ...(message.trim() ? { message: message.trim() } : {}),
    };
    const result = await create.mutateAsync(input);
    onClose();
    navigate(`/workstreams/${result.workstream.id}`);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={600}>New workstream</Text>}
      size="lg"
    >
      <Stack gap="sm">
        <TextInput
          label="Title"
          placeholder="Short label for this workstream"
          value={title}
          onChange={setTitle}
        />
        <Select
          label="Repo"
          placeholder="Choose a repository"
          data={repoOptions}
          value={repoId || undefined}
          onChange={(value) => setRepoId(value ?? '')}
          disabled={repoOptions.length === 0 || Boolean(repos.error)}
        />
        {repos.data?.length === 0 && (
          <Text size="sm" c="dimmed">
            Add a repos entry in artificer.config.json.
          </Text>
        )}
        {repos.error && (
          <Text size="sm" c="red">
            {repos.error instanceof Error
              ? repos.error.message
              : String(repos.error)}
          </Text>
        )}
        <Select
          label="Agent"
          data={[
            { value: 'instance', label: 'Instance default' },
            { value: 'llm', label: 'Built-in loop' },
            { value: 'claude-code', label: 'Claude Code' },
            { value: 'cursor-agent', label: 'Cursor' },
          ]}
          value={agent}
          onChange={(value) => setAgent((value ?? 'instance') as AgentChoice)}
        />
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Goal
          </Text>
          <Textarea
            placeholder="What should this workstream accomplish?"
            autosize
            minRows={3}
            value={goal}
            onChange={(event) => setGoal(event.currentTarget.value)}
          />
        </Stack>
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Opening message <Text c="dimmed">(optional)</Text>
          </Text>
          <Textarea
            placeholder="Start the conversation…"
            autosize
            minRows={3}
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
          />
        </Stack>
        {create.error && (
          <Text size="sm" c="red">
            {create.error instanceof Error
              ? create.error.message
              : String(create.error)}
          </Text>
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onPress={onClose}>
            Cancel
          </Button>
          <Button
            onPress={() => void submit()}
            loading={create.isPending}
            isDisabled={disabled}
          >
            Create workstream
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
