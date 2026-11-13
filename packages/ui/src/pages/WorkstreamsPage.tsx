import {
  Badge,
  Button,
  Card,
  Grid,
  HStack,
  Heading,
  Spinner,
  Text,
  Stack,
  useDisclosure,
} from '@var-ui/react';
import { IconPlus } from '@tabler/icons-react';
import { useWorkstreams } from '../api/hooks';
import { NewWorkstreamModal } from '../components/NewWorkstreamModal';
import { StatusBadge } from '../components/StatusBadge';
import { relativeTime } from '../format';

export function WorkstreamsPage() {
  const { data, isLoading } = useWorkstreams();
  const modal = useDisclosure(false);

  return (
    <Stack gap="lg">
      <HStack justify="between">
        <Heading level={3} size="md">
          Workstreams
        </Heading>
        <Button
          tone="accent"
          appearance="filled"
          size="sm"
          onClick={modal.show}
        >
          <IconPlus size={14} />
          New workstream
        </Button>
      </HStack>
      {isLoading && <Spinner size="sm" label="Loading workstreams" />}
      {data?.length === 0 && (
        <Text tone="secondary" size="sm">
          No workstreams yet. Start a chat here, or ask the agent from Messages.
        </Text>
      )}
      <Grid columns="auto">
        {data?.map((ws) => (
          <Card key={ws.id} href={`/workstreams/${ws.id}`} title={ws.title}>
            <Stack gap="xs">
              <Text size="sm" tone="secondary" lineClamp={3}>
                {ws.summary || ws.goal}
              </Text>
              <HStack justify="between" wrap>
                <HStack gap="xs">
                  <StatusBadge status={ws.status} />
                  <Badge>
                    {ws.driver === 'conversation' ? 'Chat' : 'Machine'}
                  </Badge>
                  {ws.repoId && (
                    <Text as="span" size="xs" tone="secondary">
                      {ws.repoId}
                    </Text>
                  )}
                </HStack>
                <Text as="span" size="xs" tone="secondary">
                  Updated {relativeTime(ws.updatedAt)}
                </Text>
              </HStack>
            </Stack>
          </Card>
        ))}
      </Grid>
      <NewWorkstreamModal opened={modal.open} onClose={modal.hide} />
    </Stack>
  );
}
