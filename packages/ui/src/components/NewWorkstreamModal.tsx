import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCreateWorkstream,
  useRepos,
  type CreateWorkstreamInput,
} from '../api/hooks';
import {
  Button,
  Dialog,
  Select,
  Stack,
  Text,
  TextAreaField,
  TextField,
} from '@var-ui/react';

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
            options={[
              { value: 'instance', label: 'Instance default' },
              { value: 'llm', label: 'Built-in loop' },
              { value: 'claude-code', label: 'Claude Code' },
              { value: 'cursor-agent', label: 'Cursor' },
            ]}
            value={agent}
            onValueChange={(value) =>
              setAgent((value ?? 'instance') as AgentChoice)
            }
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
