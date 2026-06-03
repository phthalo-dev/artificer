import {
  Badge,
  Box,
  Code,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import type { RunNode, RunRecord, ToolInvocation } from '../api/types';

const ROLE_COLOR: Record<string, string> = {
  communicator: 'grape',
  orchestrator: 'indigo',
  planner: 'blue',
  worker: 'teal',
  reviewer: 'violet',
  librarian: 'orange',
};

function roleColor(role: string): string {
  return ROLE_COLOR[role] ?? 'gray';
}

/** Depth-first, start-time-ordered flatten of the call tree into a step list. */
function flatten(tree: RunNode[]): RunRecord[] {
  const out: RunRecord[] = [];
  const visit = (nodes: RunNode[]) => {
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
  visit(tree);
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

/** Grayscale-ish barcode of steps, colored by role (DeepSWE-style timeline). */
function Barcode({ runs }: { runs: RunRecord[] }) {
  return (
    <Group
      gap={2}
      wrap="nowrap"
      style={{ overflowX: 'auto', padding: '6px 0' }}
    >
      {runs.map((run, i) => (
        <Tooltip
          key={run.id}
          label={`#${i + 1} · ${run.role}${
            run.toolCalls.length ? ` · ${run.toolCalls.length} tools` : ''
          }`}
          withArrow
        >
          <Box
            style={{
              width: 6,
              height: 36,
              flex: '0 0 auto',
              borderRadius: 1,
              opacity: run.status === 'failed' ? 0.5 : 1,
              backgroundColor: `var(--mantine-color-${roleColor(run.role)}-${
                run.status === 'failed' ? 4 : 6
              })`,
            }}
          />
        </Tooltip>
      ))}
    </Group>
  );
}

function ToolCall({ call, index }: { call: ToolInvocation; index: number }) {
  const [open, setOpen] = useState(false);
  const hint = toolHint(call.input);
  return (
    <Box>
      <UnstyledButton
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%' }}
      >
        <Group gap={6} wrap="nowrap" align="center">
          {open ? (
            <IconChevronDown size={13} />
          ) : (
            <IconChevronRight size={13} />
          )}
          <Text size="xs" c="dimmed" w={18} ta="right">
            {index + 1}
          </Text>
          <Code style={{ fontSize: 11 }}>{call.name}</Code>
          {hint && (
            <Text size="xs" c="dimmed" lineClamp={1} style={{ minWidth: 0 }}>
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
        <Box ml={37} my={6}>
          <Text size="xs" c="dimmed" fw={600} mb={2}>
            Input
          </Text>
          <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
            {typeof call.input === 'string'
              ? call.input
              : JSON.stringify(call.input, null, 2)}
          </Code>
          <Text size="xs" c="dimmed" fw={600} mt={6} mb={2}>
            Output
          </Text>
          <Code
            block
            style={{ fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}
          >
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
    <Paper withBorder radius="md" p="sm">
      <UnstyledButton onClick={() => setOpen((o) => !o)} style={{ width: '100%' }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            {open ? (
              <IconChevronDown size={15} />
            ) : (
              <IconChevronRight size={15} />
            )}
            <Text size="sm" c="dimmed" w={28} ta="right">
              #{index + 1}
            </Text>
            <Badge color={roleColor(run.role)} variant="light" radius="sm">
              {run.role}
            </Badge>
            {run.model && (
              <Code style={{ fontSize: 11 }} c="dimmed">
                {run.model}
              </Code>
            )}
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
          </Group>
        </Group>
      </UnstyledButton>

      <Collapse in={open}>
        <Box ml={36} mt={8}>
          {run.task && (
            <>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={2}>
                Task
              </Text>
              <Text size="sm" mb="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {run.task}
              </Text>
            </>
          )}

          {run.toolCalls.length > 0 && (
            <Stack gap={2} mb="sm">
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
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
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

export function BenchTrajectory({ tree }: { tree: RunNode[] }) {
  const runs = flatten(tree);
  if (runs.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No trajectory captured for this instance. Re-run{' '}
        <Code>pnpm bench</Code> to record one.
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      <Barcode runs={runs} />
      {runs.map((run, i) => (
        <Step key={run.id} run={run} index={i} />
      ))}
    </Stack>
  );
}

/** Total tool calls across the tree — the agent's "steps". */
export function countSteps(tree: RunNode[]): number {
  return flatten(tree).reduce((sum, r) => sum + r.toolCalls.length, 0);
}

/** Largest single-run context (input + cache reads) reached in the tree. */
export function peakContext(tree: RunNode[]): number {
  let peak = 0;
  const visit = (nodes: RunNode[]) => {
    for (const n of nodes) {
      const ctx = n.self.inputTokens + n.self.cacheReadInputTokens;
      if (ctx > peak) peak = ctx;
      visit(n.children);
    }
  };
  visit(tree);
  return peak;
}
