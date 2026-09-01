import { useEffect, useRef } from 'react';
import { Text } from '../ds';
import { color } from '../ds/tokens';
import { relativeTime } from '../format';
import { useSSEEvents, type ActivityEntry } from '../api/hooks';
import {
  feedDot,
  feedEmpty,
  feedHeader,
  feedLabel,
  feedRoot,
  feedRow,
  feedRowMain,
  feedScroll,
  feedTime,
} from './ActivityFeed.styles';

const DOT_COLOR: Record<ActivityEntry['kind'], string> = {
  message: color.blue,
  workstream: color.violet,
  run: color.orange,
  tool: color.gray,
  quota: color.yellow,
  approval: color.red,
};

function FeedRow({ entry }: { entry: ActivityEntry }) {
  return (
    <div className={feedRow}>
      <div className={feedRowMain}>
        <span
          className={feedDot}
          style={{ background: DOT_COLOR[entry.kind] }}
        />
        <span className={feedLabel}>{entry.label}</span>
      </div>
      <span className={feedTime}>{relativeTime(entry.at)}</span>
    </div>
  );
}

export function ActivityFeed() {
  const entries = useSSEEvents();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div className={feedRoot}>
      <div className={feedHeader}>Activity</div>
      <div className={feedScroll}>
        {entries.length === 0 ? (
          <Text size="xs" c="dimmed" className={feedEmpty}>
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
