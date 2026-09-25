import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from '../ds';
import { useWorkstreamTrace } from '../api/hooks';
import type { TraceEvent } from '../api/types';
import { formatTime, relativeTime } from '../format';
import { TRACE_KIND_COLORS, traceEventLabel } from '../trace-event-label';
import { ViewRawLink } from './ViewRawLink';

function TraceEventRow({ event }: { event: TraceEvent }) {
  const [open, setOpen] = useState(false);
  const color = TRACE_KIND_COLORS[event.kind];

  return (
    <Paper p="sm" withBorder>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="xs" align="flex-start" wrap="nowrap" style={{ flex: 1 }}>
          <Button
            variant="subtle"
            size="sm"
            onPress={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse event' : 'Expand event'}
            style={{ minWidth: 28, padding: 0 }}
          >
            {open ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
          </Button>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="wrap">
              <Text size="xs" c="dimmed" fw={600}>
                #{event.sequence}
              </Text>
              <Badge color={color} size="sm">
                {event.kind}
              </Badge>
              {event.actor?.role && (
                <Badge color="gray" size="sm" variant="light">
                  {event.actor.role}
                </Badge>
              )}
              {event.runId && (
                <Text size="xs" c="dimmed">
                  run <Code>{event.runId}</Code>
                </Text>
              )}
            </Group>
            <Text size="sm" lineClamp={open ? undefined : 2}>
              {traceEventLabel(event)}
            </Text>
          </Stack>
        </Group>
        <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
          <Text size="xs" c="dimmed">
            {formatTime(event.at)}
          </Text>
          <Text size="xs" c="dimmed">
            {relativeTime(event.at)}
          </Text>
        </Stack>
      </Group>
      {open && (
        <div style={{ marginTop: 8 }}>
          <Paper p="sm" withBorder>
            <Text
              component="pre"
              size="xs"
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {JSON.stringify(event.data, null, 2)}
            </Text>
          </Paper>
        </div>
      )}
    </Paper>
  );
}

export function WorkstreamTracePanel({
  workstreamId,
}: {
  workstreamId: string;
}) {
  const { data, isLoading, error } = useWorkstreamTrace(workstreamId);

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) {
    return (
      <Alert color="red" title="Could not load trace">
        {error instanceof Error ? error.message : 'Trace unavailable'}
      </Alert>
    );
  }

  const { trace, events, hasMore } = data;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Durable trace
            </Text>
            {trace.backfilled && (
              <Badge color="gray" size="sm">
                backfilled
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            <Code>{trace.id}</Code> · {trace.eventCount} events · seq{' '}
            {trace.lastSequence}
          </Text>
          <Text size="xs" c="dimmed">
            Updated {formatTime(trace.updatedAt)}
          </Text>
        </Stack>
        <ViewRawLink data={data} filename={`trace-${trace.id}.json`} />
      </Group>

      {events.length === 0 ? (
        <Alert color="gray">No trace events recorded yet.</Alert>
      ) : (
        <Stack gap="xs">
          {events.map((event) => (
            <TraceEventRow key={event.id} event={event} />
          ))}
        </Stack>
      )}

      {hasMore && (
        <Alert color="blue" title="More events available">
          Showing the first {events.length} of {trace.eventCount} events. Use
          the raw export or trace API for the full journal.
        </Alert>
      )}
    </Stack>
  );
}
