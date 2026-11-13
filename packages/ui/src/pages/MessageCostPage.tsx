import {
  Alert,
  Heading,
  HStack,
  Link,
  Spinner,
  Stack,
  Surface,
  Text,
} from '@var-ui/react';
import { IconArrowLeft } from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { useMessageCost, useWorkstreams } from '../api/hooks';
import { BreakdownTable } from '../components/BreakdownTable';
import { CallTree } from '../components/CallTree';
import { UsageStats } from '../components/UsageStats';
import { formatTime } from '../format';
import { t } from '../styles/system';

export function MessageCostPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useMessageCost(id);
  const { data: workstreams } = useWorkstreams();

  if (isLoading) return <Spinner size="sm" label="Loading message cost" />;
  if (error || !data) {
    return (
      <Alert tone="danger" title="Could not load message cost">
        {error instanceof Error ? error.message : 'Not found'}
      </Alert>
    );
  }

  const wsTitle = (wid: string) =>
    workstreams?.find((w) => w.id === wid)?.title ?? wid;

  return (
    <Stack gap="lg">
      <Link
        href="/usage"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: t.space.xxs.var,
          alignSelf: 'flex-start',
          fontSize: t.fontSize.sm.var,
        }}
      >
        <IconArrowLeft size={14} /> Back to usage
      </Link>

      <Stack gap="xs">
        <Heading level={3} size="md">
          Message cost
        </Heading>
        <Surface padding="sm">
          <Stack gap="xs">
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {data.message.content}
            </Text>
            <Text size="xs" tone="secondary">
              {formatTime(data.message.createdAt)}
            </Text>
          </Stack>
        </Surface>
      </Stack>

      <Stack gap="xs">
        <Text weight="semibold">Total</Text>
        <UsageStats usage={data.total} />
      </Stack>

      <HStack align="start" wrap gap="md">
        <Stack gap="xs">
          <Text weight="semibold" size="sm">
            By role
          </Text>
          <BreakdownTable label="Role" data={data.byRole} />
        </Stack>
        <Stack gap="xs">
          <Text weight="semibold" size="sm">
            By workstream
          </Text>
          <BreakdownTable
            label="Workstream"
            data={data.byWorkstream}
            renderKey={(wid) => ({
              label: wsTitle(wid),
              to: `/workstreams/${wid}`,
            })}
          />
        </Stack>
      </HStack>

      <Stack gap="xs">
        <Heading level={5} size="xs">
          Call tree
        </Heading>
        <Text size="xs" tone="secondary">
          Each call shows its own (self) cost and the cumulative cost (Σ) of its
          whole subtree.
        </Text>
        <CallTree tree={data.tree} />
      </Stack>
    </Stack>
  );
}
