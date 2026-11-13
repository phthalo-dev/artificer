import { IconDownload } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import type { Tone } from '@var-ui/core';
import {
  Alert,
  Badge,
  Button,
  Code,
  HStack,
  Spinner,
  Stack,
  Surface,
  Table,
  Text,
  toast,
} from '@var-ui/react';
import {
  useApproveArtifactVersion,
  useArtifactContent,
  useReleaseArtifactVersion,
  useRequestArtifactApproval,
  useWorkstreamArtifacts,
} from '../api/hooks';
import type {
  ArtifactVersionState,
  ArtifactVersionSummary,
  WorkstreamArtifact,
} from '../api/types';
import { formatTime } from '../format';
import { MarkdownContent } from './MarkdownContent';
import { clickableRow, eyebrow, preBlock } from './Workstream.styles';

const VERSION_STATE_TONES: Record<ArtifactVersionState, Tone> = {
  draft: 'neutral',
  ready: 'info',
  approved: 'success',
  released: 'accent',
  rejected: 'danger',
};

const APPROVAL_TONES: Record<WorkstreamArtifact['approvalStatus'], Tone> = {
  not_requested: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadText(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function VersionActions({
  workstreamId,
  artifact,
  version,
}: {
  workstreamId: string;
  artifact: WorkstreamArtifact;
  version: ArtifactVersionSummary;
}) {
  const approve = useApproveArtifactVersion(
    workstreamId,
    artifact.key,
    version.version,
  );
  const release = useReleaseArtifactVersion(
    workstreamId,
    artifact.key,
    version.version,
  );
  const requestApproval = useRequestArtifactApproval(
    workstreamId,
    artifact.key,
    version.version,
  );
  const busy =
    approve.isPending || release.isPending || requestApproval.isPending;

  async function run(
    label: string,
    fn: () => Promise<{ artifact: WorkstreamArtifact }>,
  ) {
    try {
      await fn();
      toast({
        title: label,
        description: `${artifact.key} ${version.version} updated.`,
        tone: 'success',
      });
    } catch (error) {
      toast({
        title: `${label} failed`,
        description: error instanceof Error ? error.message : 'Request failed',
        tone: 'danger',
      });
    }
  }

  return (
    <HStack gap="xs">
      {artifact.approvalStatus === 'not_requested' &&
        version.state !== 'released' && (
          <Button
            appearance="outline"
            size="sm"
            loading={busy}
            onClick={() =>
              void run('Approval requested', () =>
                requestApproval.mutateAsync(),
              )
            }
          >
            Request approval
          </Button>
        )}
      {artifact.approvalStatus === 'pending' &&
        version.state !== 'approved' && (
          <Button
            appearance="outline"
            size="sm"
            loading={busy}
            onClick={() => void run('Approved', () => approve.mutateAsync())}
          >
            Approve
          </Button>
        )}
      {version.state === 'approved' &&
        artifact.currentVersion !== version.version && (
          <Button
            tone="accent"
            appearance="filled"
            size="sm"
            loading={busy}
            onClick={() => void run('Released', () => release.mutateAsync())}
          >
            Release
          </Button>
        )}
    </HStack>
  );
}

function ArtifactPreview({
  workstreamId,
  artifact,
  version,
}: {
  workstreamId: string;
  artifact: WorkstreamArtifact;
  version: ArtifactVersionSummary;
}) {
  const { data, isLoading, error } = useArtifactContent(
    workstreamId,
    artifact.key,
    version.version,
  );

  if (isLoading) return <Spinner size="sm" label="Loading content" />;
  if (error || !data) {
    return (
      <Alert tone="danger" title="Could not load content">
        {error instanceof Error ? error.message : 'Content unavailable'}
      </Alert>
    );
  }

  const isMarkdown =
    data.contentType.includes('markdown') ||
    artifact.key === 'plan' ||
    artifact.key === 'report' ||
    artifact.key === 'receipt';

  return (
    <Stack gap="sm">
      <HStack justify="between">
        <Text size="xs" tone="secondary">
          {data.contentType}
          {data.truncated ? ' · truncated preview' : ''} ·{' '}
          {formatBytes(version.byteSize)} · sha256{' '}
          <Code>{version.sha256.slice(0, 12)}…</Code>
        </Text>
        <Button
          appearance="outline"
          size="sm"
          onClick={() =>
            downloadText(
              data.content,
              `${artifact.key}-${version.version}`,
              data.contentType,
            )
          }
        >
          <IconDownload size={14} />
          Download
        </Button>
      </HStack>
      <Surface padding="md">
        {isMarkdown ? (
          <MarkdownContent content={data.content} />
        ) : (
          <pre className={preBlock}>{data.content}</pre>
        )}
      </Surface>
    </Stack>
  );
}

function ArtifactDetail({
  workstreamId,
  artifact,
}: {
  workstreamId: string;
  artifact: WorkstreamArtifact;
}) {
  const sortedVersions = useMemo(
    () =>
      [...artifact.versions].sort((a, b) =>
        b.version.localeCompare(a.version, undefined, { numeric: true }),
      ),
    [artifact.versions],
  );
  const [selectedVersion, setSelectedVersion] = useState(
    () => artifact.currentVersion ?? sortedVersions[0]?.version,
  );
  const version =
    sortedVersions.find((v) => v.version === selectedVersion) ??
    sortedVersions[0];

  return (
    <Stack gap="md">
      {artifact.description && (
        <Text size="sm" tone="secondary">
          {artifact.description}
        </Text>
      )}

      <Table striped hasHover>
        <Table.Header>
          <Table.Row>
            <Table.Column>Version</Table.Column>
            <Table.Column>State</Table.Column>
            <Table.Column>Size</Table.Column>
            <Table.Column>Created</Table.Column>
            <Table.Column>Trace seq</Table.Column>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sortedVersions.map((v) => (
            <Table.Row
              key={v.version}
              className={clickableRow}
              selected={v.version === version?.version}
              onClick={() => setSelectedVersion(v.version)}
            >
              <Table.Cell>
                <HStack gap="xs">
                  <Text as="span" size="sm" weight="semibold">
                    {v.version}
                  </Text>
                  {artifact.currentVersion === v.version && (
                    <Badge tone="accent">current</Badge>
                  )}
                </HStack>
              </Table.Cell>
              <Table.Cell>
                <Badge tone={VERSION_STATE_TONES[v.state]}>{v.state}</Badge>
              </Table.Cell>
              <Table.Cell>
                <Text size="sm">{formatBytes(v.byteSize)}</Text>
              </Table.Cell>
              <Table.Cell>
                <Text size="sm">{formatTime(v.createdAt)}</Text>
              </Table.Cell>
              <Table.Cell>
                <Text size="sm" tone="secondary">
                  {v.sourceTraceSequence ?? '—'}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>

      {version && (
        <>
          <VersionActions
            workstreamId={workstreamId}
            artifact={artifact}
            version={version}
          />
          <ArtifactPreview
            workstreamId={workstreamId}
            artifact={artifact}
            version={version}
          />
        </>
      )}
    </Stack>
  );
}

export function WorkstreamArtifactsPanel({
  workstreamId,
}: {
  workstreamId: string;
}) {
  const {
    data: artifacts,
    isLoading,
    error,
  } = useWorkstreamArtifacts(workstreamId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (isLoading) return <Spinner size="sm" label="Loading artifacts" />;
  if (error) {
    return (
      <Alert tone="danger" title="Could not load artifacts">
        {error instanceof Error ? error.message : 'Artifacts unavailable'}
      </Alert>
    );
  }

  const list = artifacts ?? [];
  const selected = list.find((a) => a.key === selectedKey) ?? list[0] ?? null;

  return (
    <Stack gap="md">
      <Text size="xs" tone="secondary" weight="semibold" className={eyebrow}>
        Versioned artifacts
      </Text>

      {list.length === 0 ? (
        <Alert tone="neutral">
          No artifacts yet. Agents can publish plans, diffs, reports, and other
          deliverables as versioned artifacts.
        </Alert>
      ) : (
        <>
          <Table striped hasHover>
            <Table.Header>
              <Table.Row>
                <Table.Column>Key</Table.Column>
                <Table.Column>Name</Table.Column>
                <Table.Column>Current</Table.Column>
                <Table.Column>Versions</Table.Column>
                <Table.Column>Approval</Table.Column>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {list.map((artifact) => (
                <Table.Row
                  key={artifact.key}
                  className={clickableRow}
                  selected={selected?.key === artifact.key}
                  onClick={() => setSelectedKey(artifact.key)}
                >
                  <Table.Cell>
                    <Code>{artifact.key}</Code>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="sm">{artifact.name}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="sm">{artifact.currentVersion ?? '—'}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="sm">{artifact.versions.length}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge tone={APPROVAL_TONES[artifact.approvalStatus]}>
                      {artifact.approvalStatus.replace(/_/g, ' ')}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>

          {selected && (
            <Surface padding="md">
              <Stack gap="md">
                <HStack gap="xs">
                  <Text as="span" weight="semibold">
                    {selected.name}
                  </Text>
                  <Badge>{selected.visibility}</Badge>
                  {selected.archivedAt && <Badge>archived</Badge>}
                </HStack>
                <ArtifactDetail
                  workstreamId={workstreamId}
                  artifact={selected}
                />
              </Stack>
            </Surface>
          )}
        </>
      )}
    </Stack>
  );
}
