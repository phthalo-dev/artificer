import { Badge, Heading, HStack, Stack, Text } from '@var-ui/react';
import { useRuntimeState, useUsage } from '../api/hooks';
import { CLOUD_MODE } from '../api/client';
import { UsageStats } from '../components/UsageStats';

export function DashboardPage() {
  const state = useRuntimeState();
  const usage = useUsage();

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level={3} size="md">
          Dashboard
        </Heading>
        <HStack gap="xs" wrap>
          {state.isError ? (
            <Badge tone="warning">
              {CLOUD_MODE ? 'hibernating or starting' : 'offline'}
            </Badge>
          ) : (
            <Badge tone={state.data?.busy ? 'info' : 'neutral'}>
              {state.data?.busy ? 'working' : 'idle'}
            </Badge>
          )}
          <Badge>{state.data?.queue.running ?? 0} running</Badge>
          <Badge>{state.data?.queue.pending ?? 0} queued</Badge>
          <Badge>{state.data?.activeRuns.length ?? 0} active calls</Badge>
        </HStack>
      </Stack>

      {usage.data && (
        <Stack gap="xs">
          <Text weight="semibold">Total usage</Text>
          <UsageStats usage={usage.data.total} />
        </Stack>
      )}
    </Stack>
  );
}
