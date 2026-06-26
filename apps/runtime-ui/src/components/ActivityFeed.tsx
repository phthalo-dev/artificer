import { useEffect, useRef } from 'react';
import { Group, Text } from '../ds';
import { color } from '../ds/tokens';
import { relativeTime } from '../format';
import { useSSEEvents, type ActivityEntry } from '../api/hooks';

const DOT_COLOR: Record<ActivityEntry['kind'], string> = {
  message: color.blue,
  workstream: color.violet,
  run: color.orange,
  tool: color.gray,
};

function FeedRow({ entry }: { entry: ActivityEntry }) {
  return (
    <Group
      justify="space-between"
      gap="xs"
      style={{ padding: '3px 0', alignItems: 'baseline' }}
    >
      <Group gap="xs" style={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: DOT_COLOR[entry.kind],
            flexShrink: 0,
          }}
        />
        <Text
          size="xs"
          ff="monospace"
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {entry.label}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        {relativeTime(entry.at)}
      </Text>
    </Group>
  );
}

export function ActivityFeed() {
  const entries = useSSEEvents();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Text
        fw={600}
        size="sm"
        style={{
          padding: '0 0 8px',
          borderBottom: `1px solid ${color.border}`,
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        Activity
      </Text>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <Text size="xs" c="dimmed" style={{ padding: '8px 0' }}>
            No activity yet.
          </Text>
        ) : (
          <>
            {entries.map((entry) => (
              <FeedRow key={entry.id} entry={entry} />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}
