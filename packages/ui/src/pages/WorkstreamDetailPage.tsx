import type { Tone } from '@var-ui/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Dialog,
  Grid,
  HStack,
  Heading,
  Spinner,
  Stack,
  Surface,
  Table,
  Tabs,
  Text,
  type TabsProps,
} from '@var-ui/react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  useCancelWorkstream,
  useMarkWorkstreamDone,
  useRemoveWorktree,
  useUsage,
  useWorkstream,
} from '../api/hooks';
import { ApiError } from '../api/client';
import type { ReviewSeverity, RunRecord, Workstream } from '../api/types';
import {
  BenchTrajectory,
  countSteps,
  flattenRuns,
  peakContext,
} from '../components/BenchTrajectory';
import { DataCard } from '../components/DataCard';
import { BreakdownTable } from '../components/BreakdownTable';
import { summarizeByRoute } from '../usage-breakdown';
import { MarkdownContent } from '../components/MarkdownContent';
import { StatusBadge } from '../components/StatusBadge';
import { QuotaAlert } from '../components/QuotaBanner';
import { TokenSpendByRole } from '../components/TokenSpendChart';
import { ViewRawLink } from '../components/ViewRawLink';
import { WorkstreamProgress } from '../components/WorkstreamProgress';
import { WorkstreamArtifactsPanel } from '../components/WorkstreamArtifactsPanel';
import { WorkstreamChat } from '../components/WorkstreamChat';
import { WorkstreamReceiptPanel } from '../components/WorkstreamReceiptPanel';
import { WorkstreamTracePanel } from '../components/WorkstreamTracePanel';
import {
  cellMaxWidth,
  eyebrow,
  preWrap,
  statGrid,
} from '../components/Workstream.styles';
import { formatCost, formatDuration, formatTime } from '../format';
import { agentLabel } from '../format-agent';
import { earliestQuotaReset, formatUntil } from '../quota';

const SEVERITY_TONES: Record<ReviewSeverity, Tone> = {
  critical: 'danger',
  important: 'warning',
  minor: 'warning',
  none: 'success',
};

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      as="span"
      size="xs"
      tone="secondary"
      weight="semibold"
      className={eyebrow}
    >
      {children}
    </Text>
  );
}

function workstreamDurationMs(ws: Workstream, runs: RunRecord[]): number {
  if (runs.length === 0) {
    return new Date(ws.updatedAt).getTime() - new Date(ws.createdAt).getTime();
  }
  const starts = runs.map((r) =>
    new Date(r.startedAt ?? r.createdAt).getTime(),
  );
  const ends = runs.map((r) => new Date(r.finishedAt ?? r.createdAt).getTime());
  return Math.max(...ends) - Math.min(...starts);
}

function primaryModel(runs: RunRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const label = run.executor ?? run.model;
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

const TERMINAL_STATUSES = new Set(['done', 'failed', 'blocked', 'cancelled']);

export function WorkstreamDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useWorkstream(id);
  const { data: usageOverview } = useUsage();
  const cancel = useCancelWorkstream(id);
  const markDone = useMarkWorkstreamDone(id);
  const removeWorktree = useRemoveWorktree(id);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (isLoading) return <Spinner size="sm" label="Loading workstream" />;
  if (error || !data) {
    return (
      <Alert tone="danger" title="Could not load workstream">
        {error instanceof Error ? error.message : 'Not found'}
      </Alert>
    );
  }

  const { workstream: ws, tasks, reviews, plan, tree, usage } = data;
  const runs = flattenRuns(tree);
  const steps = countSteps(tree);
  const peakCtx = peakContext(tree);
  const durationMs = workstreamDurationMs(ws, data.runs);
  const model = primaryModel(data.runs);
  const quotaReset = earliestQuotaReset(usageOverview?.quota);
  const conversation = ws.driver === 'conversation';
  const canStop = conversation
    ? ws.status === 'in_progress'
    : !TERMINAL_STATUSES.has(ws.status);
  const canRemove = TERMINAL_STATUSES.has(ws.status);
  const resolvedExecutor = ws.executor ?? data.resolvedExecutor ?? undefined;
  const hasExecutorLabel =
    ws.executor !== undefined || Object.hasOwn(data, 'resolvedExecutor');

  const remove = (force = false) => {
    setRemoveError(null);
    removeWorktree.mutate(force ? { force: true } : {}, {
      onSuccess: () => setConfirmRemove(false),
      onError: (err) => {
        if (
          !force &&
          err instanceof ApiError &&
          err.status === 409 &&
          /uncommitted|unpushed/i.test(err.message)
        ) {
          setConfirmRemove(true);
          return;
        }
        setRemoveError(err instanceof Error ? err.message : String(err));
      },
    });
  };

  const trajectoryPanel = (
    <Stack gap="sm">
      <HStack justify="between">
        <HStack gap="xs">
          <SectionLabel>{model ?? 'sub-agents'}</SectionLabel>
          <Text as="span" size="xs" tone="secondary">
            · {usage.total.runs} calls · {formatCost(usage.total.costUsd)}
          </Text>
        </HStack>
        <ViewRawLink
          data={{ workstream: ws, tasks, reviews, plan, tree, usage }}
          filename={`workstream-${ws.id}.json`}
        />
      </HStack>
      {runs.length > 0 ? (
        <BenchTrajectory tree={tree} />
      ) : (
        <Alert tone="neutral">
          No agent calls recorded for this workstream yet.
        </Alert>
      )}
    </Stack>
  );

  const planPanel = plan ? (
    <Card>
      <MarkdownContent content={plan} />
    </Card>
  ) : (
    <Text tone="secondary" size="sm">
      No plan yet.
    </Text>
  );

  const tasksPanel =
    tasks.length === 0 ? (
      <Text tone="secondary" size="sm">
        No tasks yet.
      </Text>
    ) : (
      <Table striped>
        <Table.Header>
          <Table.Row>
            <Table.Column>Role</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column>Description</Table.Column>
            <Table.Column>Result</Table.Column>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {tasks.map((task) => (
            <Table.Row key={task.id}>
              <Table.Cell>
                <Text size="sm" weight="semibold">
                  {task.role}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <StatusBadge status={task.status} />
              </Table.Cell>
              <Table.Cell className={cellMaxWidth}>
                <Text size="sm">{task.description}</Text>
              </Table.Cell>
              <Table.Cell className={cellMaxWidth}>
                <Text size="sm" tone="secondary" lineClamp={3}>
                  {task.result ?? '—'}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    );

  const reviewsPanel =
    reviews.length === 0 ? (
      <Text tone="secondary" size="sm">
        No reviews yet.
      </Text>
    ) : (
      <Stack gap="sm">
        {reviews.map((r) => (
          <Card key={r.id}>
            <Stack gap="xs">
              <HStack justify="between">
                <HStack gap="xs">
                  <Text as="span" size="sm" weight="semibold">
                    {r.target}
                  </Text>
                  {r.stage ? <Badge>{r.stage}</Badge> : null}
                </HStack>
                <HStack gap="xs">
                  {r.severity && r.severity !== 'none' ? (
                    <Badge tone={SEVERITY_TONES[r.severity]}>
                      {r.severity}
                    </Badge>
                  ) : null}
                  <Badge tone={r.approved ? 'success' : 'warning'}>
                    {r.approved ? 'approved' : 'changes requested'}
                  </Badge>
                </HStack>
              </HStack>
              <MarkdownContent content={r.notes} />
              <Text size="xs" tone="secondary">
                {formatTime(r.createdAt)}
              </Text>
            </Stack>
          </Card>
        ))}
      </Stack>
    );

  const metricsPanel = (
    <Stack gap="lg">
      <Grid columns="auto" className={statGrid}>
        <DataCard label="Requests" value={String(usage.total.requests)} />
        <DataCard
          label="Cache read"
          value={usage.total.cacheReadInputTokens.toLocaleString()}
        />
        <DataCard
          label="Cache write"
          value={usage.total.cacheCreationInputTokens.toLocaleString()}
        />
        <DataCard label="Updated" value={formatTime(ws.updatedAt)} />
      </Grid>
      <Stack gap="xs">
        <Text weight="semibold" size="sm">
          By route
        </Text>
        <BreakdownTable label="Route" data={summarizeByRoute(data.runs)} />
      </Stack>
      <Stack gap="xs">
        <Text weight="semibold" size="sm">
          By role
        </Text>
        <BreakdownTable label="Role" data={usage.byRole} />
      </Stack>
      <Stack gap="xs">
        <Text weight="semibold" size="sm">
          By task
        </Text>
        <BreakdownTable label="Task" data={usage.byTask} />
      </Stack>
    </Stack>
  );

  const tracePanel = <WorkstreamTracePanel workstreamId={ws.id} />;
  const artifactsPanel = <WorkstreamArtifactsPanel workstreamId={ws.id} />;

  const tabs: TabsProps['tabs'] = conversation
    ? [
        {
          value: 'chat',
          label: 'Chat',
          content: (
            <WorkstreamChat
              workstreamId={ws.id}
              status={ws.status}
              runs={data.runs}
            />
          ),
        },
        { value: 'artifacts', label: 'Artifacts', content: artifactsPanel },
        { value: 'trajectory', label: 'Trajectory', content: trajectoryPanel },
        { value: 'trace', label: 'Trace', content: tracePanel },
      ]
    : [
        { value: 'trajectory', label: 'Trajectory', content: trajectoryPanel },
        { value: 'plan', label: 'Plan', content: planPanel },
        { value: 'tasks', label: 'Tasks', content: tasksPanel },
        { value: 'reviews', label: 'Reviews', content: reviewsPanel },
        { value: 'metrics', label: 'Metrics', content: metricsPanel },
        { value: 'trace', label: 'Trace', content: tracePanel },
        { value: 'artifacts', label: 'Artifacts', content: artifactsPanel },
        {
          value: 'receipt',
          label: 'Receipt',
          content: <WorkstreamReceiptPanel workstream={ws} />,
        },
      ];

  return (
    <Stack gap="lg">
      {ws.status === 'paused_quota' && (
        <Alert tone="warning" title="Paused — usage quota">
          Work is temporarily paused until the quota window resets.
          {quotaReset && (
            <>
              {' '}
              Expected to resume {formatUntil(quotaReset)} (
              {formatTime(quotaReset)}).
            </>
          )}
          {ws.quotaPausedStatus && (
            <>
              {' '}
              Will return to{' '}
              <strong>{ws.quotaPausedStatus.replace(/_/g, ' ')}</strong> when
              quota clears.
            </>
          )}
        </Alert>
      )}

      <QuotaAlert />
      <Stack gap="xs">
        <Text size="xs" tone="secondary">
          <Code>{ws.id}</Code>
        </Text>
        <HStack gap="sm" wrap>
          <Heading level={2} size="lg">
            {ws.title}
          </Heading>
          <StatusBadge status={ws.status} />
          {canStop && (
            <Button
              tone="danger"
              appearance="outline"
              size="sm"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Stop
            </Button>
          )}
          {conversation && ws.status === 'in_progress' && (
            <Button
              appearance="outline"
              size="sm"
              loading={markDone.isPending}
              onClick={() => markDone.mutate()}
            >
              Mark done
            </Button>
          )}
          {canRemove && (
            <Button
              appearance="outline"
              size="sm"
              loading={removeWorktree.isPending}
              onClick={() => remove()}
            >
              Remove working tree
            </Button>
          )}
        </HStack>
        {data?.progress && (
          <WorkstreamProgress progress={data.progress} status={ws.status} />
        )}
        <Text tone="secondary" size="sm" className={preWrap}>
          {ws.goal}
        </Text>
        {ws.repoUrl && (
          <Text size="sm">
            repo: <Code>{ws.repoUrl}</Code>
          </Text>
        )}
        {conversation && (
          <HStack gap="sm" wrap>
            {ws.repoId && (
              <Text as="span" size="sm">
                repo id: <Code>{ws.repoId}</Code>
              </Text>
            )}
            <Text as="span" size="sm">
              branch: <Code>{`artificer/${ws.id}`}</Code>
            </Text>
            {hasExecutorLabel && (
              <Text as="span" size="sm">
                agent: <Code>{agentLabel(resolvedExecutor)}</Code>
              </Text>
            )}
          </HStack>
        )}
        {removeError && (
          <Text size="sm" tone="danger">
            {removeError}
          </Text>
        )}
      </Stack>

      {ws.summary && (
        <Card>
          <Stack gap="xs">
            <SectionLabel>Summary</SectionLabel>
            <Text size="sm" className={preWrap}>
              {ws.summary}
            </Text>
          </Stack>
        </Card>
      )}

      <Surface padding="md">
        <Grid columns="auto" className={statGrid}>
          <DataCard size="lg" label="Steps" value={String(steps)} />
          <DataCard size="lg" label="Calls" value={String(usage.total.runs)} />
          <DataCard
            size="lg"
            label="Cost"
            value={formatCost(usage.total.costUsd)}
          />
          <DataCard
            size="lg"
            label="Input tok"
            value={usage.total.inputTokens.toLocaleString()}
          />
          <DataCard
            size="lg"
            label="Output tok"
            value={usage.total.outputTokens.toLocaleString()}
          />
          <DataCard
            size="lg"
            label="Peak ctx"
            value={peakCtx > 0 ? peakCtx.toLocaleString() : '—'}
          />
          <DataCard
            size="lg"
            label="Duration"
            value={formatDuration(durationMs)}
          />
        </Grid>
      </Surface>

      {runs.length > 0 && <TokenSpendByRole byRole={usage.byRole} />}

      <Tabs tabs={tabs} defaultValue={conversation ? 'chat' : 'trajectory'} />

      <Dialog
        open={confirmRemove}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(false);
        }}
      >
        <Dialog.Popup>
          <Dialog.Header>
            <Dialog.Title>Remove working tree?</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Description>
            This checkout has uncommitted files or commits that are not on the
            base branch. Force removal discards uncommitted files. Commits stay
            on <Code>{`artificer/${ws.id}`}</Code>.
          </Dialog.Description>
          <Dialog.Actions>
            <Button appearance="subtle" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              tone="danger"
              appearance="filled"
              loading={removeWorktree.isPending}
              onClick={() => remove(true)}
            >
              Force remove
            </Button>
          </Dialog.Actions>
        </Dialog.Popup>
      </Dialog>
    </Stack>
  );
}
