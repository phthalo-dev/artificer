import { Stack, Text, Title } from '../ds';
import { QuotaPanel } from '../components/QuotaPanel';
import { RoutesEditor } from '../components/RoutesEditor';

export function ProvidersPage() {
  return (
    <Stack gap="xl">
      <div>
        <Title order={3}>Providers</Title>
        <Text size="sm" c="dimmed" mt={4}>
          An ordered chain of execution routes. Each route defines how work runs
          (LLM or agent), which models are available per tier, and its quota
          windows. When a route is exhausted, the runtime tries the next one.
        </Text>
      </div>

      <RoutesEditor />

      <Stack gap="md">
        <Title order={4}>Current usage</Title>
        <QuotaPanel />
      </Stack>
    </Stack>
  );
}
