import {
  Badge,
  type BadgeProps,
  Box,
  Code,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from '../ds';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import type { RunNode, RunRecord, ToolInvocation } from '../api/types';
import { TokenSpendTimeline } from './TokenSpendChart';
import { fullWidth, minWidthZero, stepHeader } from './BenchTrajectory.styles';

type BadgeColor = NonNullable<BadgeProps['color']>;

const ROLE_COLOR: Record<string, BadgeColor> = {
  communicator: 'grape',
  orchestrator: 'indigo',
  planner: 'blue',
  worker: 'teal',
  reviewer: 'violet',
  librarian: 'orange',
};

function roleColor(role: string): BadgeColor {
  return ROLE_COLOR[role] ?? 'gray';
}

const stepHeaderCls = stepHeader;

function normalizeTree(tree: RunNode[] | null | undefined): RunNode[] {
  return Array.isArray(tree) ? tree : [];
}

/** Depth-first, start-time-ordered flatten of the call tree into a step list. */
export function flattenRuns(tree: RunNode[] | null | undefined): RunRecord[] {
  const out: RunRecord[] = [];
  const visit = (nodes: RunNode[] | null | undefined) => {
    if (!Array.isArray(nodes)) return;
    const ordered = [...nodes].sort((a, b) =>
      (a.run.startedAt ?? a.run.createdAt).localeCompare(
        b.run.startedAt ?? b.run.createdAt,
      ),
    );
    for (const node of ordered) {
      out.push(node.run);
      visit(node.children);
    }
  };
  visit(normalizeTree(tree));
  return out;
}

function runDurationMs(run: RunRecord): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  return new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
}

/** A short single-line hint pulled from a tool call's input. */
function toolHint(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const key = [
    'command',
    'path',
    'query',
    'workstreamId',
    'status',
    'description',
  ].find((k) => typeof obj[k] === 'string');
  if (!key) return '';
  const value = String(obj[key]).replace(/\s+/g, ' ').trim();
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

function ToolCall({ call, index }: { call: ToolInvocation; index: number }) {
  const [open, setOpen] = useState(false);
  const hint = toolHint(call.input);
  return (
    <Box>
      <UnstyledButton onPress={() => setOpen((o) => !o)} className={fullWidth}>
        <Group gap={6} wrap="nowrap" align="center">
          {open ? (
            <IconChevronDown size={13} />
          ) : (
            <IconChevronRight size={13} />
          )}
          <Text size="xs" c="dimmed" w={18} ta="right">
            {index + 1}
          </Text>
          <Code size="xs">{call.name}</Code>
          {hint && (
            <Text size="xs" c="dimmed" lineClamp={1} className={minWidthZero}>
              {hint}
            </Text>
          )}
          {call.error && (
            <Badge size="xs" color="red" variant="light">
              error
            </Badge>
          )}
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Box ml={37} mt={6} mb={6}>
          <Text size="xs" c="dimmed" fw={600} mb={2}>
            Input
          </Text>
          <Code block size="xs">
            {typeof call.input === 'string'
              ? call.input
              : JSON.stringify(call.input, null, 2)}
          </Code>
          <Text size="xs" c="dimmed" fw={600} mt={6} mb={2}>
            Output
          </Text>
          <Code block size="xs" scroll>
            {call.error ? `${call.error}\n${call.output}` : call.output || '—'}
          </Code>
        </Box>
      </Collapse>
    </Box>
  );
}

function Step({ run, index }: { run: RunRecord; index: number }) {
  const [open, setOpen] = useState(index < 6);
  const dur = runDurationMs(run);
  return (
    <Paper p="0">
      <UnstyledButton
        className={stepHeaderCls}
        onPress={() => setOpen((o) => !o)}
      >
        <Group justify="space-between" wrap="nowrap" className={fullWidth}>
          <Group gap={8} wrap="nowrap" className={minWidthZero}>
            <Text size="sm" c="dimmed" w={28} ta="right">
              #{index + 1}
            </Text>
            <Badge color={roleColor(run.role)} variant="light">
              {run.role}
            </Badge>
            {run.model && <Code size="xs">{run.model}</Code>}
            {run.status === 'failed' && (
              <Badge size="sm" color="red" variant="light">
                failed
              </Badge>
            )}
          </Group>
          <Group gap="md" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {run.toolCalls.length} tools
            </Text>
            {dur !== null && (
              <Text size="xs" c="dimmed">
                {(dur / 1000).toFixed(1)}s
              </Text>
            )}
            {open ? (
              <IconChevronDown size={15} />
            ) : (
              <IconChevronRight size={15} />
            )}
          </Group>
        </Group>
      </UnstyledButton>

      <Collapse in={open}>
        <Box p="sm">
          {run.task && (
            <>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={2}>
                Task
              </Text>
              <Text size="sm" mb={8} preWrap>
                {run.task}
              </Text>
            </>
          )}

          {run.toolCalls.length > 0 && (
            <Stack gap={2} mb={8}>
              {run.toolCalls.map((call, i) => (
                <ToolCall key={`${run.id}-${i}`} call={call} index={i} />
              ))}
            </Stack>
          )}

          {run.output && (
            <>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={2}>
                Output
              </Text>
              <Text size="sm" preWrap>
                {run.output}
              </Text>
            </>
          )}

          {run.error && (
            <Text size="sm" c="red" mt={4}>
              {run.error}
            </Text>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

export function BenchTrajectory({
  tree,
}: {
  tree: RunNode[] | null | undefined;
}) {
  const runs = flattenRuns(tree);
  if (runs.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No trajectory captured for this instance. Re-run <Code>pnpm bench</Code>{' '}
        to record one.
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      <TokenSpendTimeline runs={runs} />
      {runs.map((run, i) => (
        <Step key={run.id} run={run} index={i} />
      ))}
    </Stack>
  );
}

/** Total tool calls across the tree — the agent's "steps". */
export function countSteps(tree: RunNode[] | null | undefined): number {
  return flattenRuns(tree).reduce((sum, r) => sum + r.toolCalls.length, 0);
}

/** Largest single-run context (input + cache reads) reached in the tree. */
export function peakContext(tree: RunNode[] | null | undefined): number {
  let peak = 0;
  const visit = (nodes: RunNode[] | null | undefined) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      const ctx =
        (n.self?.inputTokens ?? 0) + (n.self?.cacheReadInputTokens ?? 0);
      if (ctx > peak) peak = ctx;
      visit(n.children);
    }
  };
  visit(normalizeTree(tree));
  return peak;
}
