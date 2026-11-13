import type { ReactNode } from 'react';
import { Heading, Link, Spinner, Stack, Text } from '@var-ui/react';
import { useUsage, useWorkstreams } from '../api/hooks';
import { BreakdownTable } from '../components/BreakdownTable';
import { QuotaAlert } from '../components/QuotaBanner';
import { QuotaPanel } from '../components/QuotaPanel';
import { UsageStats } from '../components/UsageStats';

function UsageSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Stack gap="sm">
      <Heading level={5} size="xs">
        {title}
      </Heading>
      {children}
    </Stack>
  );
}

export function UsagePage() {
  const { data, isLoading } = useUsage();
  const { data: workstreams } = useWorkstreams();

  if (isLoading || !data) return <Spinner size="sm" label="Loading usage" />;

  const wsTitle = (id: string) =>
    workstreams?.find((w) => w.id === id)?.title ?? id;

  return (
    <Stack gap="lg">
      <Heading level={3} size="md">
        Usage &amp; cost
      </Heading>

      <QuotaAlert />

      <QuotaPanel />

      <Text size="sm" tone="secondary">
        Configure routes, failover, and model presets on the{' '}
        <Link href="/providers">Providers</Link> page.
      </Text>

      <Stack gap="xs">
        <Text weight="semibold">Grand total</Text>
        <UsageStats usage={data.total} />
      </Stack>

      <UsageSection title="By route">
        <BreakdownTable label="Route" data={data.byRoute ?? {}} />
      </UsageSection>

      <UsageSection title="By model">
        <BreakdownTable label="Model" data={data.byModel} />
      </UsageSection>

      <UsageSection title="By role">
        <BreakdownTable label="Role" data={data.byRole} />
      </UsageSection>

      <UsageSection title="By workstream">
        <BreakdownTable
          label="Workstream"
          data={data.byWorkstream}
          renderKey={(id) => ({
            label: wsTitle(id),
            to: `/workstreams/${id}`,
          })}
        />
      </UsageSection>

      <UsageSection title="By message">
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
      </UsageSection>
    </Stack>
  );
}
