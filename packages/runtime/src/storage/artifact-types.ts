export type ArtifactApprovalStatus =
  | 'not_requested'
  | 'pending'
  | 'approved'
  | 'rejected';

export type ArtifactVisibility = 'private' | 'link' | 'public';

export type ArtifactVersionState =
  | 'draft'
  | 'ready'
  | 'approved'
  | 'released'
  | 'rejected';

export interface ArtifactVersionSummary {
  version: string;
  contentType: string;
  sha256: string;
  byteSize: number;
  createdAt: string;
  createdByRunId?: string;
  sourceTraceSequence?: number;
  state: ArtifactVersionState;
  sourcePath?: string;
  metadata?: Record<string, string | number | boolean>;
  releasedAt?: string;
}

export interface WorkstreamArtifact {
  schemaVersion: 1;
  id: string;
  workstreamId: string;
  traceId?: string;
  key: string;
  name: string;
  description?: string;
  contentType: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  currentVersion?: string;
  approvalStatus: ArtifactApprovalStatus;
  visibility: ArtifactVisibility;
  versions: ArtifactVersionSummary[];
}

export interface ArtifactVersionRecord extends ArtifactVersionSummary {
  schemaVersion: 1;
}

export interface CreateArtifactInput {
  key: string;
  name: string;
  description?: string;
  contentType: string;
  traceId?: string;
  visibility?: ArtifactVisibility;
}

export interface CreateArtifactVersionInput {
  content: Buffer | string;
  contentType?: string;
  createdByRunId?: string;
  sourceTraceSequence?: number;
  sourcePath?: string;
  metadata?: Record<string, string | number | boolean>;
  idempotencyKey?: string;
}

export interface PatchArtifactInput {
  name?: string;
  description?: string;
  contentType?: string;
  visibility?: ArtifactVisibility;
}

/** Adapter-neutral boundary for future external publication. */
export interface ArtifactPublisher {
  createOrResolveArtifact(
    artifact: WorkstreamArtifact,
  ): Promise<{ externalId: string; url?: string }>;

  uploadVersion(
    artifact: WorkstreamArtifact,
    version: ArtifactVersionSummary,
    content: AsyncIterable<Uint8Array>,
  ): Promise<void>;

  releaseVersion(
    artifact: WorkstreamArtifact,
    version: ArtifactVersionSummary,
  ): Promise<{ url?: string }>;
}

export const ARTIFACT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const ARTIFACT_VERSION_PATTERN = /^v[0-9]+$/;

export const BUILTIN_ARTIFACT_KEYS = [
  'plan',
  'receipt',
  'review',
  'benchmark',
  'diff',
  'report',
] as const;
