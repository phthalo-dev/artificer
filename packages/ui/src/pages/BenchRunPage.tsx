import {
  Alert,
  Badge,
  Card,
  Code,
  Grid,
  Heading,
  HStack,
  Link,
  Spinner,
  Stack,
  Tabs,
  Text,
} from '@var-ui/react';
import { grid, recipeVars, styleVars, type Tone } from '@var-ui/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { useBenchRun } from '../api/hooks';
import type { BenchRunDetail, VerifierStatus } from '../api/types';
import {
  BenchTrajectory,
  countSteps,
  peakContext,
} from '../components/BenchTrajectory';
import { BreakdownTable } from '../components/BreakdownTable';
import { TokenSpendByRole } from '../components/TokenSpendByRole';
import { ViewRawLink } from '../components/ViewRawLink';
import { cx } from '../styles/system';
import { formatCost, formatDuration } from '../format';
import {
  backLink,
  eyebrow,
  metricValue,
  patchAdd,
  patchBlock,
  patchDel,
  patchHunk,
  patchLine,
  patchMeta,
  problemStatement,
} from './BenchPage.styles';

const VERIFIER_TONE: Record<VerifierStatus, Tone> = {
  resolved: 'success',
  unresolved: 'danger',
  empty_patch: 'warning',
  error: 'danger',
  ungraded: 'neutral',
};

const metricGridStyle = styleVars([[recipeVars(grid).minColumnWidth, '8rem']]);

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="xs">
      <Text size="xs" tone="secondary" weight="semibold" className={eyebrow}>
        {label}
      </Text>
      <p className={metricValue}>{value}</p>
    </Stack>
  );
}

function VerdictBadge({ run }: { run: BenchRunDetail }) {
  if (run.resolved === true)
    return (
      <Badge tone="success" appearance="solid">
        PASS
      </Badge>
    );
  if (run.resolved === false) return <Badge tone="danger">FAIL</Badge>;
  return <Badge tone="neutral">UNGRADED</Badge>;
}

function patchLineClass(line: string): string | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return patchAdd;
  if (line.startsWith('-') && !line.startsWith('---')) return patchDel;
  if (line.startsWith('@@')) return patchHunk;
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('+++') ||
    line.startsWith('---')
  )
    return patchMeta;
  return undefined;
}

function PatchView({ patch }: { patch: string }) {
  const lines = patch.split('\n');
  return (
    <Card>
      <pre className={patchBlock}>
        {lines.map((line, i) => (
          <div key={i} className={cx(patchLine, patchLineClass(line))}>
            {line || ' '}
          </div>
        ))}
      </pre>
    </Card>
  );
}

export function BenchRunPage() {
  const { instanceId } = useParams();
  const { data, isLoading, error } = useBenchRun(instanceId);

  if (isLoading) return <Spinner size="sm" label="Loading benchmark run" />;
  if (error || !data) {
    return (
      <Alert tone="danger" title="Could not load benchmark run">
        {error instanceof Error ? error.message : 'Not found'}
      </Alert>
    );
  }

  const usage = data.usage;
  const steps = data.trajectory ? countSteps(data.trajectory) : null;
  const peakCtx = data.trajectory ? peakContext(data.trajectory) : null;

  return (
    <Stack gap="lg">
      <div>
        <Link href="/bench" className={backLink}>
          <IconArrowLeft size={14} /> Back to benchmark
        </Link>
      </div>

      <Stack gap="xs">
        <HStack gap="xs">
          <Text
            as="span"
            size="xs"
            tone="secondary"
            weight="semibold"
            className={eyebrow}
          >
            Artificer Runtime
          </Text>
          <Text as="span" size="xs" tone="secondary">
            · {data.repo}
          </Text>
        </HStack>
        <HStack gap="sm">
          <Heading level={2} size="lg">
            {data.modelName ?? 'runtime'}
          </Heading>
          <VerdictBadge run={data} />
          <Badge tone="neutral">{data.outcome.replace(/_/g, ' ')}</Badge>
        </HStack>
        <Text size="sm" tone="secondary">
          task: <Code>{data.instanceId}</Code>
        </Text>
      </Stack>

      <Card>
        <Grid columns="auto" style={metricGridStyle}>
          <Metric label="Steps" value={steps !== null ? String(steps) : '—'} />
          <Metric label="Calls" value={usage ? String(usage.runs) : '—'} />
          <Metric
            label="Cost"
            value={usage ? formatCost(usage.costUsd) : '—'}
          />
          <Metric
            label="Input tok"
            value={usage ? usage.inputTokens.toLocaleString() : '—'}
          />
          <Metric
            label="Output tok"
            value={usage ? usage.outputTokens.toLocaleString() : '—'}
          />
          <Metric
            label="Peak ctx"
            value={peakCtx !== null ? peakCtx.toLocaleString() : '—'}
          />
          <Metric label="Duration" value={formatDuration(data.durationMs)} />
        </Grid>
      </Card>

      {data.byRole && Object.keys(data.byRole).length > 0 && (
        <TokenSpendByRole byRole={data.byRole} />
      )}

      <Tabs
        defaultValue="trajectory"
        tabs={[
          {
            value: 'trajectory',
            label: 'Trajectory',
            content: (
              <Stack gap="sm">
                <HStack justify="between">
                  <HStack gap="xs">
                    <Text
                      as="span"
                      size="xs"
                      tone="secondary"
                      weight="semibold"
                      className={eyebrow}
                    >
                      {data.modelName}
                    </Text>
                    {usage && (
                      <Text as="span" size="xs" tone="secondary">
                        · {usage.runs} calls · {formatCost(usage.costUsd)}
                      </Text>
                    )}
                  </HStack>
                  <ViewRawLink
                    data={data}
                    filename={`bench-${data.instanceId}.json`}
                  />
                </HStack>
                {data.trajectory ? (
                  <BenchTrajectory tree={data.trajectory} />
                ) : (
                  <Alert tone="neutral">
                    No trajectory captured for this instance yet. Re-run{' '}
                    <Code>pnpm bench</Code> to record the agent's step-by-step
                    call tree.
                  </Alert>
                )}
              </Stack>
            ),
          },
          {
            value: 'verifier',
            label: 'Verifier output',
            content: (
              <Stack gap="sm">
                <HStack gap="sm">
                  <Badge tone={VERIFIER_TONE[data.verifier.status]}>
                    {data.verifier.status.replace(/_/g, ' ')}
                  </Badge>
                  <Text as="span" size="sm">
                    {data.verifier.note}
                  </Text>
                </HStack>
                <Text size="sm" tone="secondary">
                  SWE-bench: <Code>pnpm bench:eval</Code>. DeepSWE:{' '}
                  <Code>pnpm bench:eval:deepswe</Code>. Then{' '}
                  <Code>pnpm bench:report</Code>.
                </Text>
              </Stack>
            ),
          },
          {
            value: 'patch',
            label: 'Model patch',
            content: data.patch ? (
              <PatchView patch={data.patch} />
            ) : (
              <Text tone="secondary" size="sm">
                No patch produced ({data.patchBytes} bytes).
              </Text>
            ),
          },
          {
            value: 'metrics',
            label: 'Metrics',
            content: (
              <Stack gap="lg">
                <Stack gap="xs">
                  <Heading level={3} size="xs">
                    By role
                  </Heading>
                  <BreakdownTable label="Role" data={data.byRole} />
                </Stack>
                {data.problemStatement && (
                  <Stack gap="xs">
                    <Heading level={3} size="xs">
                      Problem statement
                    </Heading>
                    <Card>
                      <Text size="sm" className={problemStatement}>
                        {data.problemStatement}
                      </Text>
                    </Card>
                  </Stack>
                )}
              </Stack>
            ),
          },
        ]}
      />
    </Stack>
  );
}
