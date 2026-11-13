import { useEffect, useRef } from 'react';
import { Text } from '@var-ui/react';
import { hue } from '../styles/palette';
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
  message: hue.blue,
  workstream: hue.violet,
  run: hue.orange,
  tool: hue.gray,
  quota: hue.yellow,
  approval: hue.red,
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
      <Text as="div" size="sm" weight="semibold" className={feedHeader}>
        Activity
      </Text>
      <div className={feedScroll}>
        {entries.length === 0 ? (
          <Text size="xs" tone="secondary" className={feedEmpty}>
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
