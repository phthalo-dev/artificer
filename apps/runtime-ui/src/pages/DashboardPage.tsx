import {
  Badge, Group, Stack, Text, Title,
} from '../ds';
import { useRuntimeState, useUsage } from '../api/hooks';
import { CLOUD_MODE } from '../api/client';
import { UsageStats } from '../components/UsageStats';

export function DashboardPage() {
  const state = useRuntimeState();
  const usage = useUsage();

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>Dashboard</Title>
        <Group gap="xs" mt={4}>
          {state.isError ? (
            <Badge variant="light" color="orange">{CLOUD_MODE ? 'hibernating or starting' : 'offline'}</Badge>
          ) : (
            <Badge variant="light" color={state.data?.busy ? 'blue' : 'gray'}>{state.data?.busy ? 'working' : 'idle'}</Badge>
          )}
          <Badge variant="light">{state.data?.queue.running ?? 0} running</Badge>
          <Badge variant="light">{state.data?.queue.pending ?? 0} queued</Badge>
          <Badge variant="light">{state.data?.activeRuns.length ?? 0} active calls</Badge>
        </Group>
      </div>

      {usage.data && (
        <div>
          <Text fw={600} mb={8}>Total usage</Text>
          <UsageStats usage={usage.data.total} />
        </div>
      )}
    </Stack>
  );
}
