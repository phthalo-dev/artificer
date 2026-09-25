import { IconDownload } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Text,
  notifications,
} from '../ds';
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

const VERSION_STATE_COLORS: Record<
  ArtifactVersionState,
  'gray' | 'blue' | 'green' | 'violet' | 'red'
> = {
  draft: 'gray',
  ready: 'blue',
  approved: 'green',
  released: 'violet',
  rejected: 'red',
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
      notifications.show({
        title: label,
        message: `${artifact.key} ${version.version} updated.`,
        color: 'green',
      });
    } catch (error) {
      notifications.show({
        title: `${label} failed`,
        message: error instanceof Error ? error.message : 'Request failed',
        color: 'red',
      });
    }
  }

  return (
    <Group gap="xs">
      {artifact.approvalStatus === 'not_requested' &&
        version.state !== 'released' && (
          <Button
            variant="outline"
            size="sm"
            loading={busy}
            onPress={() =>
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
            variant="outline"
            size="sm"
            loading={busy}
            onPress={() => void run('Approved', () => approve.mutateAsync())}
          >
            Approve
          </Button>
        )}
      {version.state === 'approved' &&
        artifact.currentVersion !== version.version && (
          <Button
            size="sm"
            loading={busy}
            onPress={() => void run('Released', () => release.mutateAsync())}
          >
            Release
          </Button>
        )}
    </Group>
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

  if (isLoading) return <Loader size="sm" />;
  if (error || !data) {
    return (
      <Alert color="red" title="Could not load content">
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
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {data.contentType}
          {data.truncated ? ' · truncated preview' : ''} ·{' '}
          {formatBytes(version.byteSize)} · sha256{' '}
          <Code>{version.sha256.slice(0, 12)}…</Code>
        </Text>
        <Button
          variant="outline"
          size="sm"
          onPress={() =>
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
      </Group>
      <Paper p="md" withBorder>
        {isMarkdown ? (
          <MarkdownContent content={data.content} />
        ) : (
          <Text
            component="pre"
            size="sm"
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {data.content}
          </Text>
        )}
      </Paper>
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
    <Stack gap="md" mt="md">
      {artifact.description && (
        <Text size="sm" c="dimmed">
          {artifact.description}
        </Text>
      )}

      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Version</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th>Size</Table.Th>
            <Table.Th>Created</Table.Th>
            <Table.Th>Trace seq</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sortedVersions.map((v) => (
            <Table.Tr
              key={v.version}
              style={{
                cursor: 'pointer',
                background:
                  v.version === version?.version
                    ? 'var(--surface-hover)'
                    : undefined,
              }}
              onClick={() => setSelectedVersion(v.version)}
            >
              <Table.Td>
                <Group gap="xs">
                  <Text size="sm" fw={600}>
                    {v.version}
                  </Text>
                  {artifact.currentVersion === v.version && (
                    <Badge color="violet" size="sm">
                      current
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Badge color={VERSION_STATE_COLORS[v.state]} size="sm">
                  {v.state}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{formatBytes(v.byteSize)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{formatTime(v.createdAt)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {v.sourceTraceSequence ?? '—'}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
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

  if (isLoading) return <Loader size="sm" />;
  if (error) {
    return (
      <Alert color="red" title="Could not load artifacts">
        {error instanceof Error ? error.message : 'Artifacts unavailable'}
      </Alert>
    );
  }

  const list = artifacts ?? [];
  const selected = list.find((a) => a.key === selectedKey) ?? list[0] ?? null;

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        Versioned artifacts
      </Text>

      {list.length === 0 ? (
        <Alert color="gray">
          No artifacts yet. Agents can publish plans, diffs, reports, and other
          deliverables as versioned artifacts.
        </Alert>
      ) : (
        <>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Key</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Current</Table.Th>
                <Table.Th>Versions</Table.Th>
                <Table.Th>Approval</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((artifact) => (
                <Table.Tr
                  key={artifact.key}
                  style={{
                    cursor: 'pointer',
                    background:
                      selected?.key === artifact.key
                        ? 'var(--surface-hover)'
                        : undefined,
                  }}
                  onClick={() => setSelectedKey(artifact.key)}
                >
                  <Table.Td>
                    <Code>{artifact.key}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{artifact.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{artifact.currentVersion ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{artifact.versions.length}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={
                        artifact.approvalStatus === 'approved'
                          ? 'green'
                          : artifact.approvalStatus === 'pending'
                            ? 'yellow'
                            : artifact.approvalStatus === 'rejected'
                              ? 'red'
                              : 'gray'
                      }
                      size="sm"
                    >
                      {artifact.approvalStatus.replace(/_/g, ' ')}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {selected && (
            <Paper p="md" withBorder>
              <Group gap="xs" mb="xs">
                <Text fw={600}>{selected.name}</Text>
                <Badge color="gray" size="sm" variant="light">
                  {selected.visibility}
                </Badge>
                {selected.archivedAt && (
                  <Badge color="gray" size="sm">
                    archived
                  </Badge>
                )}
              </Group>
              <ArtifactDetail workstreamId={workstreamId} artifact={selected} />
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}
