import { IconCheck, IconCopy, IconDownload } from '@tabler/icons-react';
import type { Tone } from '@var-ui/core';
import { type ReactNode, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  HStack,
  Spinner,
  Stack,
  Text,
  toast,
} from '@var-ui/react';
import { useWorkstreamReceipt } from '../api/hooks';
import type { ReceiptValidation, Workstream } from '../api/types';
import { MarkdownContent } from './MarkdownContent';
import { StatusBadge } from './StatusBadge';
import { eyebrow } from './Workstream.styles';
import { formatCost, formatDuration, formatTime } from '../format';

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" tone="secondary" weight="semibold" className={eyebrow}>
      {children}
    </Text>
  );
}

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
): { label: string; tone: Tone } {
  if (sourceUpdatedAt === workstream.updatedAt) {
    return { label: 'Current', tone: 'success' };
  }
  if (traceSequence !== undefined) {
    return { label: 'Refreshing', tone: 'warning' };
  }
  return { label: 'Stale', tone: 'warning' };
}

const VALIDATION_TONES: Record<ReceiptValidation['status'], Tone> = {
  passed: 'success',
  failed: 'danger',
  skipped: 'neutral',
  unknown: 'warning',
};

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

  if (isLoading) return <Spinner size="sm" label="Loading receipt" />;
  if (error || !data) {
    return (
      <Alert tone="danger" title="Could not load receipt">
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
      toast({
        title: 'Copied',
        description: 'Receipt Markdown copied to clipboard.',
        tone: 'success',
      });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not copy receipt to the clipboard.',
        tone: 'danger',
      });
    }
  }

  return (
    <Stack gap="md">
      <HStack justify="between" align="start" wrap>
        <Stack gap="xs">
          <HStack gap="xs">
            <SectionLabel>Delivery receipt</SectionLabel>
            <Badge tone={freshness.tone}>{freshness.label}</Badge>
          </HStack>
          <Text size="xs" tone="secondary">
            Updated {formatTime(receipt.updatedAt)}
            {receipt.provenance.generatedFromTraceSequence !== undefined
              ? ` · trace seq ${receipt.provenance.generatedFromTraceSequence}`
              : ''}
          </Text>
        </Stack>
        <HStack gap="xs">
          <Button
            appearance="outline"
            size="sm"
            onClick={() => void copyMarkdown()}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? 'Copied' : 'Copy Markdown'}
          </Button>
          {markdown && (
            <Button
              appearance="outline"
              size="sm"
              onClick={() =>
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
            appearance="outline"
            size="sm"
            onClick={() =>
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
        </HStack>
      </HStack>

      <Alert tone="neutral" title="Facts vs summary">
        Structured fields such as status, steps, usage, and repository changes
        are derived from stored records. Summary text may come from workstream
        notes or agent output and is redacted before display.
      </Alert>

      {receipt.nextAction && (
        <Alert tone="info" title="Next action">
          {receipt.nextAction}
        </Alert>
      )}

      {receipt.steps.length > 0 && (
        <Card>
          <Stack gap="sm">
            <SectionLabel>Steps</SectionLabel>
            <Stack gap="xs">
              {receipt.steps.map((step) => (
                <HStack key={step.id} justify="between" align="start">
                  <Stack gap="none" style={{ flex: 1 }}>
                    <HStack gap="xs">
                      <Text as="span" size="sm" weight="semibold">
                        {step.order}. {step.label}
                      </Text>
                      <Badge>{step.role}</Badge>
                      <StatusBadge status={step.status} />
                    </HStack>
                    {step.summary && (
                      <Text size="sm" tone="secondary">
                        {step.summary}
                      </Text>
                    )}
                  </Stack>
                  {step.finishedAt && (
                    <Text size="xs" tone="secondary">
                      {formatTime(step.finishedAt)}
                    </Text>
                  )}
                </HStack>
              ))}
            </Stack>
          </Stack>
        </Card>
      )}

      {(receipt.changes.files.length > 0 ||
        receipt.changes.commits.length > 0 ||
        receipt.changes.pullRequestUrl) && (
        <Card>
          <Stack gap="sm">
            <SectionLabel>Repository changes</SectionLabel>
            <Stack gap="xs">
              {receipt.changes.branch && (
                <Text size="sm">
                  branch: <Code>{receipt.changes.branch}</Code>
                </Text>
              )}
              {receipt.changes.pullRequestUrl && (
                <Text size="sm">
                  PR: <Code>{receipt.changes.pullRequestUrl}</Code>
                </Text>
              )}
              {receipt.changes.files.length > 0 && (
                <Stack gap="none">
                  <Text size="sm" weight="semibold">
                    Files ({receipt.changes.files.length})
                  </Text>
                  {receipt.changes.files.slice(0, 12).map((file) => (
                    <Text key={file} size="sm" tone="secondary">
                      {file}
                    </Text>
                  ))}
                  {receipt.changes.files.length > 12 && (
                    <Text size="xs" tone="secondary">
                      +{receipt.changes.files.length - 12} more
                    </Text>
                  )}
                </Stack>
              )}
            </Stack>
          </Stack>
        </Card>
      )}

      {receipt.validation.length > 0 && (
        <Card>
          <Stack gap="sm">
            <SectionLabel>Validation</SectionLabel>
            <Stack gap="xs">
              {receipt.validation.map((item) => (
                <HStack key={item.label} justify="between" align="start">
                  <Stack gap="none">
                    <HStack gap="xs">
                      <Text as="span" size="sm" weight="semibold">
                        {item.label}
                      </Text>
                      <Badge tone={VALIDATION_TONES[item.status]}>
                        {item.status}
                      </Badge>
                    </HStack>
                    {item.summary && (
                      <Text size="sm" tone="secondary">
                        {item.summary}
                      </Text>
                    )}
                  </Stack>
                  {item.command && (
                    <Code style={{ maxWidth: 280 }}>{item.command}</Code>
                  )}
                </HStack>
              ))}
            </Stack>
          </Stack>
        </Card>
      )}

      <Card>
        <Stack gap="sm">
          <SectionLabel>Usage</SectionLabel>
          <HStack gap="lg" wrap>
            <Text as="span" size="sm">
              {receipt.usage.runCount} runs
            </Text>
            <Text as="span" size="sm">
              {receipt.usage.inputTokens.toLocaleString()} in /{' '}
              {receipt.usage.outputTokens.toLocaleString()} out tok
            </Text>
            {receipt.usage.estimatedCostDollars !== undefined && (
              <Text as="span" size="sm">
                {formatCost(receipt.usage.estimatedCostDollars)}
              </Text>
            )}
            {receipt.usage.durationMs !== undefined && (
              <Text as="span" size="sm">
                {formatDuration(receipt.usage.durationMs)}
              </Text>
            )}
          </HStack>
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <SectionLabel>Markdown receipt</SectionLabel>
          <MarkdownContent content={markdown} />
        </Stack>
      </Card>
    </Stack>
  );
}
