import {
  Badge,
  Code,
  CodeBlock,
  Collapsible,
  Text,
  Stack,
} from '@var-ui/react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import type { RunNode, RunRecord, ToolInvocation } from '../api/types';
import { hue, roleColor } from '../styles/palette';
import { cx } from '../styles/system';
import { TokenSpendTimeline } from './TokenSpendChart';
import {
  eyebrow,
  minWidthZero,
  preWrap,
  roleDot,
  stepIndex,
  stepTrigger,
  toolDetail,
  toolIndex,
  toolOutput,
  toolTrigger,
  triggerMeta,
  triggerRow,
} from './BenchTrajectory.styles';

function colorForRole(role: string): string {
  return roleColor[role] ?? hue.gray;
}

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
    <Collapsible
      headingLevel={5}
      expanded={open}
      onExpandedChange={setOpen}
      trigger={
        <span className={toolTrigger}>
          {open ? (
            <IconChevronDown size={13} />
          ) : (
            <IconChevronRight size={13} />
          )}
          <Text as="span" size="xs" tone="secondary" className={toolIndex}>
            {index + 1}
          </Text>
          <Code>{call.name}</Code>
          {hint && (
            <Text
              as="span"
              size="xs"
              tone="secondary"
              lineClamp={1}
              className={minWidthZero}
            >
              {hint}
            </Text>
          )}
          {call.error && <Badge tone="danger">error</Badge>}
        </span>
      }
    >
      <Stack gap="xs" className={toolDetail}>
        <Text size="xs" tone="secondary" weight="semibold">
          Input
        </Text>
        <CodeBlock
          code={
            typeof call.input === 'string'
              ? call.input
              : JSON.stringify(call.input, null, 2)
          }
          language="json"
          wrapLongLines
        />
        <Text size="xs" tone="secondary" weight="semibold">
          Output
        </Text>
        <div className={toolOutput}>
          <CodeBlock
            code={
              call.error ? `${call.error}\n${call.output}` : call.output || '—'
            }
            wrapLongLines
          />
        </div>
      </Stack>
    </Collapsible>
  );
}

function Step({ run, index }: { run: RunRecord; index: number }) {
  const [open, setOpen] = useState(index < 6);
  const dur = runDurationMs(run);
  return (
    <Collapsible
      variant="bordered"
      headingLevel={4}
      expanded={open}
      onExpandedChange={setOpen}
      trigger={
        <span className={stepTrigger}>
          <span className={cx(triggerRow, minWidthZero)}>
            <Text as="span" size="sm" tone="secondary" className={stepIndex}>
              #{index + 1}
            </Text>
            <Badge tone="neutral">
              <span
                className={roleDot}
                style={{ backgroundColor: colorForRole(run.role) }}
                aria-hidden
              />
              {run.role}
            </Badge>
            {run.model && <Code>{run.model}</Code>}
            {run.status === 'failed' && <Badge tone="danger">failed</Badge>}
          </span>
          <span className={cx(triggerRow, triggerMeta)}>
            <Text as="span" size="xs" tone="secondary">
              {run.toolCalls.length} tools
            </Text>
            {dur !== null && (
              <Text as="span" size="xs" tone="secondary">
                {(dur / 1000).toFixed(1)}s
              </Text>
            )}
            {open ? (
              <IconChevronDown size={15} />
            ) : (
              <IconChevronRight size={15} />
            )}
          </span>
        </span>
      }
    >
      <Stack gap="sm">
        {run.task && (
          <Stack gap="xs">
            <Text
              size="xs"
              tone="secondary"
              weight="semibold"
              className={eyebrow}
            >
              Task
            </Text>
            <Text size="sm" className={preWrap}>
              {run.task}
            </Text>
          </Stack>
        )}

        {run.toolCalls.length > 0 && (
          <Stack gap="none">
            {run.toolCalls.map((call, i) => (
              <ToolCall key={`${run.id}-${i}`} call={call} index={i} />
            ))}
          </Stack>
        )}

        {run.output && (
          <Stack gap="xs">
            <Text
              size="xs"
              tone="secondary"
              weight="semibold"
              className={eyebrow}
            >
              Output
            </Text>
            <Text size="sm" className={preWrap}>
              {run.output}
            </Text>
          </Stack>
        )}

        {run.error && (
          <Text size="sm" tone="danger">
            {run.error}
          </Text>
        )}
      </Stack>
    </Collapsible>
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
      <Text tone="secondary" size="sm">
        No trajectory captured for this instance. Re-run <Code>pnpm bench</Code>{' '}
        to record one.
      </Text>
    );
  }
  return (
    <Stack gap="sm">
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
