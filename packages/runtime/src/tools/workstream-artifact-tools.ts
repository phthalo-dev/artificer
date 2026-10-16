import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import type { WorkstreamArtifact } from '../storage/artifact-types.js';

const DEFAULT_READ_LIMIT = 8_192;

/** Tools for discovering, reading, and managing versioned workstream artifacts. */
export function createWorkstreamArtifactTools(ctx: ToolContext): ToolDef[] {
  const { engine, run } = ctx;
  const { artifacts } = engine;

  function workstreamId(input: Record<string, unknown>): string | undefined {
    return (input.workstreamId as string | undefined) ?? run.workstreamId;
  }

  return [
    {
      name: 'search_workstream_artifacts',
      description:
        'List versioned artifacts for a workstream. Returns metadata only, not full content bodies.',
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
          keyPrefix: {
            type: 'string',
            description: 'Optional key prefix filter.',
          },
        },
      },
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        const list = await artifacts.list(wsId);
        const prefix = input.keyPrefix as string | undefined;
        const filtered = prefix
          ? list.filter((a: WorkstreamArtifact) => a.key.startsWith(prefix))
          : list;
        return JSON.stringify(
          filtered.map((a: WorkstreamArtifact) => ({
            key: a.key,
            name: a.name,
            contentType: a.contentType,
            currentVersion: a.currentVersion,
            approvalStatus: a.approvalStatus,
            visibility: a.visibility,
            archivedAt: a.archivedAt,
            versionCount: a.versions.length,
          })),
          null,
          2,
        );
      },
    },
    {
      name: 'get_workstream_artifact',
      description:
        'Get metadata and version summaries for a named workstream artifact.',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Artifact key, e.g. plan or report.',
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
        },
        required: ['key'],
      },
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        const key = String(input.key);
        const artifact = await artifacts.get(wsId, key);
        if (!artifact) return `Error: artifact "${key}" not found.`;
        return JSON.stringify(artifact, null, 2);
      },
    },
    {
      name: 'read_workstream_artifact_version',
      description:
        'Read bounded content for a specific artifact version. Use limit for large artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Artifact key.' },
          version: {
            type: 'string',
            description:
              'Version id, e.g. v1. Defaults to the current version.',
          },
          limit: {
            type: 'number',
            description: `Max bytes to read (default ${DEFAULT_READ_LIMIT}).`,
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
        },
        required: ['key'],
      },
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        const key = String(input.key);
        const artifact = await artifacts.get(wsId, key);
        if (!artifact) return `Error: artifact "${key}" not found.`;
        const version =
          (input.version as string | undefined) ??
          artifact.currentVersion ??
          artifact.versions.at(-1)?.version;
        if (!version) return `Error: artifact "${key}" has no versions yet.`;
        const limit =
          typeof input.limit === 'number' && input.limit > 0
            ? Math.min(input.limit, 65_536)
            : DEFAULT_READ_LIMIT;
        const { content, contentType, truncated } =
          await artifacts.readVersionContent(wsId, key, version, limit);
        const text =
          contentType.startsWith('text/') ||
          contentType.includes('json') ||
          contentType.includes('markdown')
            ? content.toString('utf8')
            : `[binary ${content.byteLength} bytes, sha256 in metadata]`;
        return truncated ? `${text}\n\n[truncated at ${limit} bytes]` : text;
      },
    },
    {
      name: 'create_workstream_artifact',
      description:
        'Create artifact metadata for a workstream deliverable. Upload content separately with create_artifact_version.',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Stable artifact key (lowercase, path-safe).',
          },
          name: { type: 'string', description: 'Human-readable name.' },
          description: { type: 'string' },
          contentType: {
            type: 'string',
            description: 'Default MIME type for versions, e.g. text/markdown.',
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
        },
        required: ['key', 'name', 'contentType'],
      },
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        try {
          const artifact = await artifacts.create(wsId, {
            key: String(input.key),
            name: String(input.name),
            description: input.description as string | undefined,
            contentType: String(input.contentType),
          });
          return `Artifact "${artifact.key}" created (${artifact.id}).`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'publish_workstream_artifact',
      description:
        'Publish content immediately as the current released version of a workstream artifact.',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Stable artifact key (lowercase, path-safe).',
          },
          name: { type: 'string', description: 'Human-readable name.' },
          content: { type: 'string', description: 'Artifact body.' },
          contentType: {
            type: 'string',
            description: 'MIME type. Defaults to text/markdown.',
          },
          description: { type: 'string' },
          metadata: {
            type: 'object',
            description: 'Optional artifact version metadata.',
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
        },
        required: ['key', 'name', 'content'],
      },
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        try {
          const artifact = await artifacts.publish(wsId, {
            key: String(input.key),
            name: String(input.name),
            content: String(input.content),
            contentType: input.contentType as string | undefined,
            description: input.description as string | undefined,
            metadata: input.metadata as
              | Record<string, string | number | boolean>
              | undefined,
            createdByRunId: run.id,
          });
          return `Published ${artifact.key} ${artifact.currentVersion} as current.`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'create_artifact_version',
      description:
        'Upload immutable content for an artifact as a new version. Does not release it as current.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Artifact key.' },
          content: { type: 'string', description: 'Artifact body.' },
          contentType: { type: 'string' },
          idempotencyKey: {
            type: 'string',
            description: 'Optional key so identical re-uploads are safe.',
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream id. Defaults to the current workstream.',
          },
        },
        required: ['key', 'content'],
      },
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        try {
          const { version } = await artifacts.createVersion(
            wsId,
            String(input.key),
            {
              content: String(input.content),
              contentType: input.contentType as string | undefined,
              idempotencyKey: input.idempotencyKey as string | undefined,
              createdByRunId: run.id,
            },
          );
          return `Version ${version.version} uploaded (${version.byteSize} bytes, sha256 ${version.sha256.slice(0, 12)}…).`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'request_artifact_approval',
      description:
        'Request human approval before an artifact version can be released.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          version: { type: 'string' },
          workstreamId: { type: 'string' },
        },
        required: ['key', 'version'],
      },
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        try {
          await artifacts.requestApproval(
            wsId,
            String(input.key),
            String(input.version),
          );
          return `Approval requested for ${input.key} ${input.version}.`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'release_workstream_artifact',
      description:
        'Release an approved artifact version as the current version for reads and UI.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          version: { type: 'string' },
          workstreamId: { type: 'string' },
        },
        required: ['key', 'version'],
      },
      needsApproval: true,
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        try {
          const artifact = await artifacts.releaseVersion(
            wsId,
            String(input.key),
            String(input.version),
          );
          return `Released ${artifact.key} ${input.version} as current.`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'archive_workstream_artifact',
      description:
        'Archive an artifact without deleting its version history or content.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          workstreamId: { type: 'string' },
        },
        required: ['key'],
      },
      needsApproval: true,
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        try {
          await artifacts.archive(wsId, String(input.key));
          return `Artifact "${input.key}" archived.`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'restore_workstream_artifact',
      description: 'Restore an archived artifact to active use.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          workstreamId: { type: 'string' },
        },
        required: ['key'],
      },
      needsApproval: true,
      handler: async (input) => {
        const wsId = workstreamId(input);
        if (!wsId) return 'Error: no workstream specified.';
        try {
          await artifacts.restore(wsId, String(input.key));
          return `Artifact "${input.key}" restored.`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
