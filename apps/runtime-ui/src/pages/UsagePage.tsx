import { Link } from 'react-router-dom';
import { Anchor, Loader, Stack, Text, Title } from '../ds';
import { useUsage, useWorkstreams } from '../api/hooks';
import { BreakdownTable } from '../components/BreakdownTable';
import { QuotaAlert } from '../components/QuotaBanner';
import { QuotaPanel } from '../components/QuotaPanel';
import { UsageStats } from '../components/UsageStats';

export function UsagePage() {
  const { data, isLoading } = useUsage();
  const { data: workstreams } = useWorkstreams();

  if (isLoading || !data) return <Loader size="sm" />;

  const wsTitle = (id: string) =>
    workstreams?.find((w) => w.id === id)?.title ?? id;

  return (
    <Stack gap="lg">
      <Title order={3}>Usage &amp; cost</Title>

      <QuotaAlert />

      <QuotaPanel />

      <Text size="sm" c="dimmed">
        Configure routes, failover, and model presets on the{' '}
        <Anchor component={Link} to="/providers">
          Providers
        </Anchor>{' '}
        page.
      </Text>

      <div>
        <Text fw={600} mb={4}>
          Grand total
        </Text>
        <UsageStats usage={data.total} />
      </div>

      <div>
        <Title order={5} mb="sm">
          By route
        </Title>
        <BreakdownTable label="Route" data={data.byRoute ?? {}} />
      </div>

      <div>
        <Title order={5} mb="sm">
          By model
        </Title>
        <BreakdownTable label="Model" data={data.byModel} />
      </div>

      <div>
        <Title order={5} mb="sm">
          By role
        </Title>
        <BreakdownTable label="Role" data={data.byRole} />
      </div>

      <div>
        <Title order={5} mb="sm">
          By workstream
        </Title>
        <BreakdownTable
          label="Workstream"
          data={data.byWorkstream}
          renderKey={(id) => ({
            label: wsTitle(id),
            to: `/workstreams/${id}`,
          })}
        />
      </div>

      <div>
        <Title order={5} mb="sm">
          By message
        </Title>
        <BreakdownTable
          label="Message"
          data={Object.fromEntries(
            data.byMessage.map((m) => [m.messageId, m.usage]),
          )}
          renderKey={(id) => {
            const m = data.byMessage.find((x) => x.messageId === id);
            return {
              label: m?.content ?? id,
              to: `/messages/${id}/cost`,
            };
          }}
        />
      </div>
    </Stack>
  );
}
