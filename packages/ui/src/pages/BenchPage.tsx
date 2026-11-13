import {
  Alert,
  Badge,
  Card,
  Code,
  Grid,
  Heading,
  HStack,
  Link,
  ProgressBar,
  Spinner,
  Stack,
  Table,
  Text,
} from '@var-ui/react';
import type { Tone } from '@var-ui/core';
import { IconFlask } from '@tabler/icons-react';
import { useBenchRuns, useBenchSuites } from '../api/hooks';
import type { BenchInstanceSummary } from '../api/types';
import { BenchEfficiencyChart } from '../components/BenchEfficiencyChart';
import { formatCost, formatDuration, formatTokensShort } from '../format';
import {
  chartGrid,
  eyebrow,
  heroValue,
  runsTable,
  statValue,
  suiteCommand,
} from './BenchPage.styles';

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <Stack gap="xs">
        <Text size="xs" tone="secondary" weight="semibold" className={eyebrow}>
          {label}
        </Text>
        <p className={statValue}>{value}</p>
        {sub && (
          <Text size="xs" tone="secondary">
            {sub}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

function Verdict({ row }: { row: BenchInstanceSummary }) {
  if (row.resolved === true)
    return (
      <Badge tone="success" appearance="solid">
        PASS
      </Badge>
    );
  if (row.resolved === false) return <Badge tone="danger">FAIL</Badge>;
  return <Badge tone="neutral">ungraded</Badge>;
}

const SUITE_KIND: Record<string, { label: string; tone: Tone }> = {
  deepswe: { label: 'DeepSWE', tone: 'accent' },
  greenfield: { label: 'Greenfield', tone: 'accent' },
};

export function BenchPage() {
  const { data, isLoading, error } = useBenchRuns();
  const { data: suites } = useBenchSuites();

  if (isLoading) return <Spinner size="sm" label="Loading benchmark" />;

  if (error || !data) {
    return (
      <Stack gap="md">
        <Heading level={2} size="md">
          Benchmark
        </Heading>
        <Alert
          tone="neutral"
          title="No eval results yet"
          icon={<IconFlask size={18} />}
        >
          <Stack gap="sm">
            <Text size="sm">Run from your agent project root:</Text>
            <Stack gap="xs">
              <Code>artificer eval run</Code>
              <Code>artificer eval run --suite smoke</Code>
              <Code>artificer eval list</Code>
            </Stack>
            {suites && suites.length > 0 && (
              <>
                <Text size="sm" weight="semibold">
                  Available suites
                </Text>
                <Stack gap="xs">
                  {suites.map((s) => (
                    <Code key={s.id}>{s.runCommand}</Code>
                  ))}
                </Stack>
              </>
            )}
          </Stack>
        </Alert>
      </Stack>
    );
  }

  const {
    summary,
    instances,
    models,
    modelName,
    graded,
    suiteKind,
    suiteName,
  } = data;
  const passPct =
    summary.resolveRate !== null ? Math.round(summary.resolveRate * 100) : null;
  const kind = suiteKind
    ? (SUITE_KIND[suiteKind] ?? { label: 'SWE-bench', tone: 'success' })
    : null;

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <HStack gap="sm">
          <Heading level={2} size="md">
            Benchmark
          </Heading>
          {kind && <Badge tone={kind.tone}>{kind.label}</Badge>}
          {modelName && <Badge tone="info">{modelName}</Badge>}
        </HStack>
        {suiteName && (
          <Text size="sm" tone="secondary">
            {suiteName}
            {data.suiteDescription ? ` — ${data.suiteDescription}` : ''}
          </Text>
        )}
        {models && (
          <HStack gap="xs" wrap>
            <Text as="span" size="xs" tone="secondary">
              tiers:
            </Text>
            <Badge appearance="outline">low · {models.low}</Badge>
            <Badge appearance="outline">medium · {models.medium}</Badge>
            <Badge appearance="outline">high · {models.high}</Badge>
          </HStack>
        )}
      </Stack>

      {suites && suites.length > 0 && (
        <Card title="Available suites" headingLevel={3}>
          <Stack gap="sm">
            {suites.map((s) => (
              <HStack key={s.id} justify="between" align="start" wrap>
                <Stack gap="xs">
                  <HStack gap="xs">
                    <Text as="span" size="sm" weight="semibold">
                      {s.name}
                    </Text>
                    <Badge appearance="outline">{s.kind}</Badge>
                    <Text as="span" size="xs" tone="secondary">
                      {s.taskCount} tasks
                    </Text>
                  </HStack>
                  {s.description && (
                    <Text size="xs" tone="secondary">
                      {s.description}
                    </Text>
                  )}
                </Stack>
                <Stack gap="xs" align="end">
                  <Code className={suiteCommand}>{s.runCommand}</Code>
                  <Code className={suiteCommand}>{s.evalCommand}</Code>
                </Stack>
              </HStack>
            ))}
          </Stack>
        </Card>
      )}

      <Card>
        <Stack gap="sm">
          <HStack justify="between" align="end">
            <div>
              <Text
                size="xs"
                tone="secondary"
                weight="semibold"
                className={eyebrow}
              >
                Pass@1
              </Text>
              <p className={heroValue}>
                {passPct !== null ? `${passPct}%` : '—'}
              </p>
            </div>
            <Text size="sm" tone="secondary">
              {graded
                ? `${summary.resolved}/${summary.instances} resolved`
                : 'not yet graded'}
            </Text>
          </HStack>
          <ProgressBar
            aria-label="Pass@1"
            value={passPct ?? 0}
            showValueText={false}
            tone={passPct && passPct >= 50 ? 'success' : 'info'}
          />
        </Stack>
      </Card>

      <div className={chartGrid}>
        <BenchEfficiencyChart
          title="Score vs. cost per run"
          subtitle="Archived benchmark runs (avg cost per instance vs pass rate)"
          points={data.runEfficiency ?? []}
          xLabel="Avg cost per instance"
          yLabel="Pass@1"
        />
        <BenchEfficiencyChart
          title="Score vs. cost per instance"
          subtitle="Current run — green pass, red fail"
          points={data.instanceEfficiency ?? []}
          xLabel="Instance cost"
          yLabel="Pass / fail"
        />
      </div>

      <Grid columns="auto">
        <Stat label="Instances" value={String(summary.instances)} />
        <Stat label="Total cost" value={formatCost(summary.totalCostUsd)} />
        <Stat label="Avg cost" value={formatCost(summary.avgCostUsd)} />
        <Stat
          label="Cost / solved"
          value={
            summary.costPerSolvedUsd !== null
              ? formatCost(summary.costPerSolvedUsd)
              : 'n/a'
          }
        />
        <Stat label="LLM calls" value={String(summary.totalRuns)} />
        <Stat
          label="Tokens"
          value={formatTokensShort(summary.inputTokens)}
          sub={`${formatTokensShort(summary.outputTokens)} out`}
        />
      </Grid>

      <Table striped hasHover className={runsTable}>
        <Table.Header>
          <Table.Row>
            <Table.Column>Verdict</Table.Column>
            <Table.Column rowHeader>Instance</Table.Column>
            <Table.Column>Repo</Table.Column>
            <Table.Column>Outcome</Table.Column>
            <Table.Column align="end">Time</Table.Column>
            <Table.Column align="end">Cost</Table.Column>
            <Table.Column align="end">Calls</Table.Column>
            <Table.Column align="end">Out tok</Table.Column>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {instances.map((row) => (
            <Table.Row key={row.instanceId}>
              <Table.Cell>
                <Verdict row={row} />
              </Table.Cell>
              <Table.Cell rowHeader>
                <HStack gap="xs">
                  <Link href={`/bench/${encodeURIComponent(row.instanceId)}`}>
                    {row.instanceId}
                  </Link>
                  {row.hasTrajectory && (
                    <Badge tone="accent" appearance="outline">
                      trajectory
                    </Badge>
                  )}
                </HStack>
              </Table.Cell>
              <Table.Cell>
                <Text as="span" size="sm" tone="secondary">
                  {row.repo}
                </Text>
              </Table.Cell>
              <Table.Cell>{row.outcome.replace(/_/g, ' ')}</Table.Cell>
              <Table.Cell align="end">
                {formatDuration(row.durationMs)}
              </Table.Cell>
              <Table.Cell align="end">{formatCost(row.costUsd)}</Table.Cell>
              <Table.Cell align="end">{row.runs}</Table.Cell>
              <Table.Cell align="end">
                {formatTokensShort(row.outputTokens)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Stack>
  );
}
