import { IconCheck, IconCopy, IconDownload } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  notifications,
} from '../ds';
import { useWorkstreamReceipt } from '../api/hooks';
import type { Workstream } from '../api/types';
import { MarkdownContent } from './MarkdownContent';
import { formatTime } from '../format';

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function receiptFreshness(
  workstream: Workstream,
  sourceUpdatedAt: string,
  traceSequence?: number,
): { label: string; color: 'green' | 'yellow' | 'gray' } {
  if (sourceUpdatedAt === workstream.updatedAt) {
    return { label: 'Current', color: 'green' };
  }
  if (traceSequence !== undefined) {
    return { label: 'Refreshing', color: 'yellow' };
  }
  return { label: 'Stale', color: 'yellow' };
}

export function WorkstreamReceiptPanel({
  workstream,
}: {
  workstream: Workstream;
}) {
  const { data, isLoading, error } = useWorkstreamReceipt(workstream.id);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) {
    return (
      <Alert color="red" title="Could not load receipt">
        {error instanceof Error ? error.message : 'Receipt unavailable'}
      </Alert>
    );
  }

  const { receipt, markdown } = data;
  const freshness = receiptFreshness(
    workstream,
    receipt.provenance.sourceUpdatedAt,
    receipt.provenance.generatedFromTraceSequence,
  );

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      notifications.show({
        title: 'Copied',
        message: 'Receipt Markdown copied to clipboard.',
        color: 'green',
      });
    } catch {
      notifications.show({
        title: 'Copy failed',
        message: 'Could not copy receipt to the clipboard.',
        color: 'red',
      });
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Delivery receipt
            </Text>
            <Badge color={freshness.color} size="sm">
              {freshness.label}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            Updated {formatTime(receipt.updatedAt)}
            {receipt.provenance.generatedFromTraceSequence !== undefined
              ? ` · trace seq ${receipt.provenance.generatedFromTraceSequence}`
              : ''}
          </Text>
        </Stack>
        <Group gap="xs">
          <Button
            variant="outline"
            size="sm"
            onPress={() => void copyMarkdown()}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? 'Copied' : 'Copy Markdown'}
          </Button>
          {markdown && (
            <Button
              variant="outline"
              size="sm"
              onPress={() =>
                downloadBlob(
                  markdown,
                  `receipt-${workstream.id}.md`,
                  'text/markdown;charset=utf-8',
                )
              }
            >
              <IconDownload size={14} />
              Markdown
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onPress={() =>
              downloadBlob(
                JSON.stringify(receipt, null, 2),
                `receipt-${workstream.id}.json`,
                'application/json',
              )
            }
          >
            <IconDownload size={14} />
            JSON
          </Button>
        </Group>
      </Group>

      <Alert color="gray" title="Facts vs summary">
        Structured fields such as status, steps, usage, and repository changes
        are derived from stored records. Summary text may come from workstream
        notes or agent output and is redacted before display.
      </Alert>

      {receipt.nextAction && (
        <Alert color="blue" title="Next action">
          {receipt.nextAction}
        </Alert>
      )}

      <Paper p="md">
        <MarkdownContent content={markdown} />
      </Paper>
    </Stack>
  );
}
