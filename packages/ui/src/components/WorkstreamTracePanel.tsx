import type { Tone } from '@var-ui/core';
import {
  Alert,
  Badge,
  Code,
  CodeBlock,
  HStack,
  IconButton,
  Spinner,
  Stack,
  Surface,
  Text,
} from '@var-ui/react';
import { useState } from 'react';
import { useWorkstreamTrace } from '../api/hooks';
import type { TraceEvent } from '../api/types';
import { formatTime, relativeTime } from '../format';
import { TRACE_KIND_COLORS, traceEventLabel } from '../trace-event-label';
import { ViewRawLink } from './ViewRawLink';
import { eyebrow } from './Workstream.styles';

/** Var UI badges only have semantic tones, so collapse the categorical hues. */
const HUE_TONE: Record<
  (typeof TRACE_KIND_COLORS)[keyof typeof TRACE_KIND_COLORS],
  Tone
> = {
  blue: 'info',
  violet: 'accent',
  cyan: 'accent',
  orange: 'warning',
  yellow: 'warning',
  gray: 'neutral',
  red: 'danger',
  green: 'success',
};

function TraceEventRow({ event }: { event: TraceEvent }) {
  const [open, setOpen] = useState(false);
  const tone = HUE_TONE[TRACE_KIND_COLORS[event.kind]];

  return (
    <Surface padding="sm">
      <Stack gap="xs">
        <HStack justify="between" align="start">
          <HStack gap="xs" align="start" style={{ flex: 1, minWidth: 0 }}>
            <IconButton
              appearance="ghost"
              size="sm"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Collapse event' : 'Expand event'}
              aria-expanded={open}
              icon={open ? 'chevronDown' : 'chevronRight'}
            />
            <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <HStack gap="xs" wrap>
                <Text as="span" size="xs" tone="secondary" weight="semibold">
                  #{event.sequence}
                </Text>
                <Badge tone={tone}>{event.kind}</Badge>
                {event.actor?.role && <Badge>{event.actor.role}</Badge>}
                {event.runId && (
                  <Text as="span" size="xs" tone="secondary">
                    run <Code>{event.runId}</Code>
                  </Text>
                )}
              </HStack>
              <Text size="sm" lineClamp={open ? undefined : 2}>
                {traceEventLabel(event)}
              </Text>
            </Stack>
          </HStack>
          <Stack gap="none" align="end" style={{ flexShrink: 0 }}>
            <Text size="xs" tone="secondary">
              {formatTime(event.at)}
            </Text>
            <Text size="xs" tone="secondary">
              {relativeTime(event.at)}
            </Text>
          </Stack>
        </HStack>
        {open && (
          <CodeBlock
            code={JSON.stringify(event.data, null, 2)}
            language="json"
            wrapLongLines
          />
        )}
      </Stack>
    </Surface>
  );
}

export function WorkstreamTracePanel({
  workstreamId,
}: {
  workstreamId: string;
}) {
  const { data, isLoading, error } = useWorkstreamTrace(workstreamId);

  if (isLoading) return <Spinner size="sm" label="Loading trace" />;
  if (error || !data) {
    return (
      <Alert tone="danger" title="Could not load trace">
        {error instanceof Error ? error.message : 'Trace unavailable'}
      </Alert>
    );
  }

  const { trace, events, hasMore } = data;

  return (
    <Stack gap="md">
      <HStack justify="between" align="start">
        <Stack gap="xs">
          <HStack gap="xs">
            <Text
              as="span"
              size="xs"
              tone="secondary"
              weight="semibold"
              className={eyebrow}
            >
              Durable trace
            </Text>
            {trace.backfilled && <Badge>backfilled</Badge>}
          </HStack>
          <Text size="xs" tone="secondary">
            <Code>{trace.id}</Code> · {trace.eventCount} events · seq{' '}
            {trace.lastSequence}
          </Text>
          <Text size="xs" tone="secondary">
            Updated {formatTime(trace.updatedAt)}
          </Text>
        </Stack>
        <ViewRawLink data={data} filename={`trace-${trace.id}.json`} />
      </HStack>

      {events.length === 0 ? (
        <Alert tone="neutral">No trace events recorded yet.</Alert>
      ) : (
        <Stack gap="xs">
          {events.map((event) => (
            <TraceEventRow key={event.id} event={event} />
          ))}
        </Stack>
      )}

      {hasMore && (
        <Alert tone="info" title="More events available">
          Showing the first {events.length} of {trace.eventCount} events. Use
          the raw export or trace API for the full journal.
        </Alert>
      )}
    </Stack>
  );
}
