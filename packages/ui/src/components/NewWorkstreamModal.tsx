import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCreateWorkstream,
  useExecutors,
  useRepos,
  type CreateWorkstreamInput,
} from '../api/hooks';
import type { ExecutorOption } from '../api/types';
import {
  Button,
  Dialog,
  Select,
  Stack,
  Text,
  TextAreaField,
  TextField,
} from '@var-ui/react';

type AgentChoice = string;

const FALLBACK_EXECUTORS: ExecutorOption[] = [
  { id: 'instance', label: 'Instance default', executor: null },
  { id: 'llm', label: 'Built-in loop', executor: 'llm' },
  { id: 'claude-code', label: 'Claude Code', executor: 'claude-code' },
  { id: 'cursor-agent', label: 'Cursor', executor: 'cursor-agent' },
];

export function NewWorkstreamModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const repos = useRepos();
  const executors = useExecutors();
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
  const executorEntries =
    executors.error || !executors.data?.length
      ? FALLBACK_EXECUTORS
      : executors.data;
  const agentOptions = executorEntries.map((entry) => ({
    value: entry.id,
    label:
      entry.permissionEnforcement === 'acp-requests'
        ? `${entry.label} · policy-gated`
        : entry.label,
  }));
  const selectedExecutor = executorEntries.find(
    (e) => e.id === agent,
  )?.executor;
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
      ...(agent === 'instance' || !selectedExecutor
        ? {}
        : { executor: selectedExecutor }),
      ...(message.trim() ? { message: message.trim() } : {}),
    };
    const result = await create.mutateAsync(input);
    onClose();
    navigate(`/workstreams/${result.workstream.id}`);
  };

  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Popup>
        <Dialog.Header>
          <Dialog.Title>New workstream</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        <Stack gap="sm">
          <TextField
            label="Title"
            placeholder="Short label for this workstream"
            value={title}
            onValueChange={setTitle}
          />
          <Select
            label="Repo"
            placeholder="Choose a repository"
            options={repoOptions}
            value={repoId || null}
            onValueChange={(value) => setRepoId(value ?? '')}
            disabled={repoOptions.length === 0 || Boolean(repos.error)}
          />
          {repos.data?.length === 0 && (
            <Text size="sm" tone="secondary">
              Add a repos entry in artificer.config.json.
            </Text>
          )}
          {repos.error && (
            <Text size="sm" tone="danger">
              {repos.error instanceof Error
                ? repos.error.message
                : String(repos.error)}
            </Text>
          )}
          <Select
            label="Agent"
            options={agentOptions}
            value={agent}
            onValueChange={(value) => setAgent(value ?? 'instance')}
          />
          <TextAreaField
            label="Goal"
            placeholder="What should this workstream accomplish?"
            rows={3}
            value={goal}
            onValueChange={setGoal}
          />
          <TextAreaField
            label="Opening message (optional)"
            placeholder="Start the conversation…"
            rows={3}
            value={message}
            onValueChange={setMessage}
          />
          {create.error && (
            <Text size="sm" tone="danger">
              {create.error instanceof Error
                ? create.error.message
                : String(create.error)}
            </Text>
          )}
        </Stack>
        <Dialog.Actions>
          <Button appearance="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="accent"
            appearance="filled"
            onClick={() => void submit()}
            loading={create.isPending}
            disabled={disabled}
          >
            Create workstream
          </Button>
        </Dialog.Actions>
      </Dialog.Popup>
    </Dialog>
  );
}
