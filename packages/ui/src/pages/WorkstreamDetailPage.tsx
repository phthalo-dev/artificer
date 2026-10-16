import {
  Alert,
  Badge,
  type BadgeColor,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  color,
} from '../ds';
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
import { formatCost, formatDuration, formatTime } from '../format';
import { agentLabel } from '../format-agent';
import { earliestQuotaReset, formatUntil } from '../quota';

const SEVERITY_COLORS: Record<ReviewSeverity, BadgeColor> = {
  critical: 'red',
  important: 'orange',
  minor: 'yellow',
  none: 'green',
};

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

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) {
    return (
      <Alert color="red" title="Could not load workstream">
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

  return (
    <Stack gap="lg">
      {ws.status === 'paused_quota' && (
        <Alert color="orange" title="Paused — usage quota">
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
      <div>
        <Group gap={8} mb={4}>
          <Text size="xs" c="dimmed">
            <Code>{ws.id}</Code>
          </Text>
        </Group>
        <Group gap="sm" align="center">
          <Title order={2}>{ws.title}</Title>
          <StatusBadge status={ws.status} />
          {canStop && (
            <Button
              variant="outline"
              size="sm"
              loading={cancel.isPending}
              onPress={() => cancel.mutate()}
              style={{
                color: color.red,
                borderColor: color.red,
              }}
            >
              Stop
            </Button>
          )}
          {conversation && ws.status === 'in_progress' && (
            <Button
              variant="outline"
              size="sm"
              loading={markDone.isPending}
              onPress={() => markDone.mutate()}
            >
              Mark done
            </Button>
          )}
          {canRemove && (
            <Button
              variant="outline"
              size="sm"
              loading={removeWorktree.isPending}
              onPress={() => remove()}
            >
              Remove working tree
            </Button>
          )}
        </Group>
        {data?.progress && (
          <WorkstreamProgress progress={data.progress} status={ws.status} />
        )}
        <Text c="dimmed" size="sm" mt={4} preWrap>
          {ws.goal}
        </Text>
        {ws.repoUrl && (
          <Text size="sm" mt={4}>
            repo: <Code>{ws.repoUrl}</Code>
          </Text>
        )}
        {conversation && (
          <Group gap="sm" mt={4}>
            {ws.repoId && (
              <Text size="sm">
                repo id: <Code>{ws.repoId}</Code>
              </Text>
            )}
            <Text size="sm">
              branch: <Code>{`artificer/${ws.id}`}</Code>
            </Text>
            {hasExecutorLabel && (
              <Text size="sm">
                agent: <Code>{agentLabel(resolvedExecutor)}</Code>
              </Text>
            )}
          </Group>
        )}
        {removeError && (
          <Text size="sm" c="red" mt={4}>
            {removeError}
          </Text>
        )}
      </div>

      {ws.summary && (
        <Card padding="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
            Summary
          </Text>
          <Text size="sm" preWrap>
            {ws.summary}
          </Text>
        </Card>
      )}

      <Paper p="lg">
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 7 }}>
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
        </SimpleGrid>
      </Paper>

      {runs.length > 0 && <TokenSpendByRole byRole={usage.byRole} />}

      <Tabs
        defaultValue={conversation ? 'chat' : 'trajectory'}
        keepMounted={false}
      >
        <Tabs.List>
          {conversation ? (
            <>
              <Tabs.Tab value="chat">Chat</Tabs.Tab>
              <Tabs.Tab value="artifacts">Artifacts</Tabs.Tab>
              <Tabs.Tab value="trajectory">Trajectory</Tabs.Tab>
              <Tabs.Tab value="trace">Trace</Tabs.Tab>
            </>
          ) : (
            <>
              <Tabs.Tab value="trajectory">Trajectory</Tabs.Tab>
              <Tabs.Tab value="plan">Plan</Tabs.Tab>
              <Tabs.Tab value="tasks">Tasks</Tabs.Tab>
              <Tabs.Tab value="reviews">Reviews</Tabs.Tab>
              <Tabs.Tab value="metrics">Metrics</Tabs.Tab>
              <Tabs.Tab value="trace">Trace</Tabs.Tab>
              <Tabs.Tab value="artifacts">Artifacts</Tabs.Tab>
              <Tabs.Tab value="receipt">Receipt</Tabs.Tab>
            </>
          )}
        </Tabs.List>

        {conversation && (
          <Tabs.Panel value="chat" pt="md">
            <WorkstreamChat
              workstreamId={ws.id}
              status={ws.status}
              runs={data.runs}
            />
          </Tabs.Panel>
        )}

        <Tabs.Panel value="trajectory" pt="md">
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {model ?? 'sub-agents'}
              </Text>
              <Text size="xs" c="dimmed">
                · {usage.total.runs} calls · {formatCost(usage.total.costUsd)}
              </Text>
            </Group>
            <ViewRawLink
              data={{ workstream: ws, tasks, reviews, plan, tree, usage }}
              filename={`workstream-${ws.id}.json`}
            />
          </Group>
          {runs.length > 0 ? (
            <BenchTrajectory tree={tree} />
          ) : (
            <Alert color="gray">
              No agent calls recorded for this workstream yet.
            </Alert>
          )}
        </Tabs.Panel>

        {!conversation && (
          <Tabs.Panel value="plan" pt="md">
            {plan ? (
              <Paper p="md">
                <MarkdownContent content={plan} />
              </Paper>
            ) : (
              <Text c="dimmed" size="sm">
                No plan yet.
              </Text>
            )}
          </Tabs.Panel>
        )}

        {!conversation && (
          <Tabs.Panel value="tasks" pt="md">
            {tasks.length === 0 ? (
              <Text c="dimmed" size="sm">
                No tasks yet.
              </Text>
            ) : (
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Role</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Description</Table.Th>
                    <Table.Th>Result</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {tasks.map((t) => (
                    <Table.Tr key={t.id}>
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {t.role}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <StatusBadge status={t.status} />
                      </Table.Td>
                      <Table.Td maw={320}>
                        <Text size="sm">{t.description}</Text>
                      </Table.Td>
                      <Table.Td maw={320}>
                        <Text size="sm" c="dimmed" lineClamp={3}>
                          {t.result ?? '—'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Tabs.Panel>
        )}

        {!conversation && (
          <Tabs.Panel value="reviews" pt="md">
            {reviews.length === 0 ? (
              <Text c="dimmed" size="sm">
                No reviews yet.
              </Text>
            ) : (
              <Stack gap="sm">
                {reviews.map((r) => (
                  <Card key={r.id} padding="sm">
                    <Group justify="space-between" mb={4}>
                      <Group gap="xs">
                        <Text size="sm" fw={600}>
                          {r.target}
                        </Text>
                        {r.stage ? (
                          <Badge color="gray" size="sm">
                            {r.stage}
                          </Badge>
                        ) : null}
                      </Group>
                      <Group gap="xs">
                        {r.severity && r.severity !== 'none' ? (
                          <Badge color={SEVERITY_COLORS[r.severity]} size="sm">
                            {r.severity}
                          </Badge>
                        ) : null}
                        <Badge color={r.approved ? 'green' : 'orange'}>
                          {r.approved ? 'approved' : 'changes requested'}
                        </Badge>
                      </Group>
                    </Group>
                    <MarkdownContent content={r.notes} />
                    <Text size="xs" c="dimmed" mt={4}>
                      {formatTime(r.createdAt)}
                    </Text>
                  </Card>
                ))}
              </Stack>
            )}
          </Tabs.Panel>
        )}

        {!conversation && (
          <Tabs.Panel value="metrics" pt="md">
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                <DataCard
                  label="Requests"
                  value={String(usage.total.requests)}
                />
                <DataCard
                  label="Cache read"
                  value={usage.total.cacheReadInputTokens.toLocaleString()}
                />
                <DataCard
                  label="Cache write"
                  value={usage.total.cacheCreationInputTokens.toLocaleString()}
                />
                <DataCard label="Updated" value={formatTime(ws.updatedAt)} />
              </SimpleGrid>
              <div>
                <Text fw={600} size="sm" mb={6}>
                  By route
                </Text>
                <BreakdownTable
                  label="Route"
                  data={summarizeByRoute(data.runs)}
                />
              </div>
              <div>
                <Text fw={600} size="sm" mb={6}>
                  By role
                </Text>
                <BreakdownTable label="Role" data={usage.byRole} />
              </div>
              <div>
                <Text fw={600} size="sm" mb={6}>
                  By task
                </Text>
                <BreakdownTable label="Task" data={usage.byTask} />
              </div>
            </Stack>
          </Tabs.Panel>
        )}

        <Tabs.Panel value="trace" pt="md">
          <WorkstreamTracePanel workstreamId={ws.id} />
        </Tabs.Panel>

        <Tabs.Panel value="artifacts" pt="md">
          <WorkstreamArtifactsPanel workstreamId={ws.id} />
        </Tabs.Panel>

        {!conversation && (
          <Tabs.Panel value="receipt" pt="md">
            <WorkstreamReceiptPanel workstream={ws} />
          </Tabs.Panel>
        )}
      </Tabs>

      <Modal
        opened={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={<Text fw={600}>Remove working tree?</Text>}
      >
        <Stack gap="md">
          <Text size="sm">
            This checkout has uncommitted files or commits that are not on the
            base branch. Force removal discards uncommitted files. Commits stay
            on <Code>{`artificer/${ws.id}`}</Code>.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onPress={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              loading={removeWorktree.isPending}
              onPress={() => remove(true)}
              style={{ color: color.red }}
            >
              Force remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
