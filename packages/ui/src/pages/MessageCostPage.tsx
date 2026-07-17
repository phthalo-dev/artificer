import { Alert, Anchor, Card, Group, Loader, Stack, Text, Title } from '../ds';
import { IconArrowLeft } from '@tabler/icons-react';
import { Link, useParams } from 'react-router-dom';
import { useMessageCost, useWorkstreams } from '../api/hooks';
import { BreakdownTable } from '../components/BreakdownTable';
import { CallTree } from '../components/CallTree';
import { UsageStats } from '../components/UsageStats';
import { formatTime } from '../format';

export function MessageCostPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useMessageCost(id);
  const { data: workstreams } = useWorkstreams();

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) {
    return (
      <Alert color="red" title="Could not load message cost">
        {error instanceof Error ? error.message : 'Not found'}
      </Alert>
    );
  }

  const wsTitle = (wid: string) =>
    workstreams?.find((w) => w.id === wid)?.title ?? wid;

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/usage" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Back to usage
        </Group>
      </Anchor>

      <div>
        <Stack gap="xs">
          <Title order={3}>Message cost</Title>
          <Card padding="sm">
            <Text size="sm" preWrap>
              {data.message.content}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              {formatTime(data.message.createdAt)}
            </Text>
          </Card>
        </Stack>
      </div>

      <div>
        <Text fw={600} mb={4}>
          Total
        </Text>
        <UsageStats usage={data.total} />
      </div>

      <Group align="flex-start" wrap="wrap">
        <div>
          <Text fw={600} size="sm" mb={4}>
            By role
          </Text>
          <BreakdownTable label="Role" data={data.byRole} />
        </div>
        <div>
          <Text fw={600} size="sm" mb={4}>
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
        </div>
      </Group>

      <div>
        <Title order={5} mb="sm">
          Call tree
        </Title>
        <Text size="xs" c="dimmed" mb={8}>
          Each call shows its own (self) cost and the cumulative cost (Σ) of its
          whole subtree.
        </Text>
        <CallTree tree={data.tree} />
      </div>
    </Stack>
  );
}
