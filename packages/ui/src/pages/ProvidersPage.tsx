import { Heading, Stack, Text } from '@var-ui/react';
import { QuotaPanel } from '../components/QuotaPanel';
import { RoutesEditor } from '../components/RoutesEditor';

export function ProvidersPage() {
  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Heading level={3} size="md">
          Providers
        </Heading>
        <Text size="sm" tone="secondary">
          An ordered chain of execution routes. Each route defines how work runs
          (LLM or agent), which models are available per tier, and its quota
          windows. When a route is exhausted, the runtime tries the next one.
        </Text>
      </Stack>

      <RoutesEditor />

      <Stack gap="md">
        <Heading level={4} size="sm">
          Current usage
        </Heading>
        <QuotaPanel />
      </Stack>
    </Stack>
  );
}
