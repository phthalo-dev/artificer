import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newId } from '../storage/store.js';
import { Layout } from '../storage/layout.js';
import type { Store } from '../storage/store.js';
import type { TraceMutation } from '../storage/types.js';
import {
  ARTIFACT_KEY_PATTERN,
  ARTIFACT_VERSION_PATTERN,
  type ArtifactVersionRecord,
  type ArtifactVersionSummary,
  type CreateArtifactInput,
  type CreateArtifactVersionInput,
  type PatchArtifactInput,
  type WorkstreamArtifact,
} from '../storage/artifact-types.js';

const artifactChains = new Map<string, Promise<void>>();

function now(): string {
  return new Date().toISOString();
}

function safeWorkstreamId(workstreamId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(workstreamId)) {
    throw new Error('Invalid workstream id');
  }
  return workstreamId;
}

export function validateArtifactKey(key: string): void {
  if (!ARTIFACT_KEY_PATTERN.test(key)) {
    throw new Error(
      'Invalid artifact key; use lowercase letters, digits, dots, underscores, or hyphens',
    );
  }
}

export function validateArtifactVersion(version: string): void {
  if (!ARTIFACT_VERSION_PATTERN.test(version)) {
    throw new Error('Invalid artifact version; expected v1, v2, …');
  }
}

function chainKey(workstreamId: string, key: string): string {
  return `${workstreamId}:${key}`;
}

async function withArtifactChain<T>(
  workstreamId: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = chainKey(workstreamId, key);
  const prev = artifactChains.get(id) ?? Promise.resolve();
  let result!: T;
  const next = prev
    .catch(() => {})
    .then(async () => {
      result = await fn();
    });
  artifactChains.set(id, next);
  await next;
  return result;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      return null;
    }
    throw err;
  }
}

function assertUnderRoot(root: string, target: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('Path escapes artifact root');
  }
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function nextVersionId(artifact: WorkstreamArtifact): string {
  const numbers = artifact.versions
    .map((v) => Number.parseInt(v.version.slice(1), 10))
    .filter((n) => Number.isFinite(n));
  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `v${next}`;
}

export interface PublishArtifactInput {
  key: string;
  name: string;
  content: Buffer | string;
  contentType?: string;
  description?: string;
  metadata?: Record<string, string | number | boolean>;
  createdByRunId?: string;
}

export class WorkstreamArtifactService {
  constructor(
    private readonly store: Store,
    private readonly recordTrace: (mutation: TraceMutation) => Promise<void>,
  ) {}

  private layout(): Layout {
    return this.store.layout;
  }

  private artifactRoot(workstreamId: string, key: string): string {
    safeWorkstreamId(workstreamId);
    validateArtifactKey(key);
    return this.layout().artifactDir(workstreamId, key);
  }

  private resolveContentPath(
    workstreamId: string,
    key: string,
    version: string,
  ): string {
    validateArtifactVersion(version);
    const root = this.artifactRoot(workstreamId, key);
    const contentPath = this.layout().artifactVersionContentFile(
      workstreamId,
      key,
      version,
    );
    assertUnderRoot(root, contentPath);
    return contentPath;
  }

  async list(workstreamId: string): Promise<WorkstreamArtifact[]> {
    safeWorkstreamId(workstreamId);
    const dir = this.layout().artifactsDir(workstreamId);
    let entries: string[];
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      entries = items
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: WorkstreamArtifact[] = [];
    for (const key of entries.sort()) {
      const artifact = await this.get(workstreamId, key);
      if (artifact) out.push(artifact);
    }
    return out;
  }

  async get(
    workstreamId: string,
    key: string,
  ): Promise<WorkstreamArtifact | null> {
    safeWorkstreamId(workstreamId);
    validateArtifactKey(key);
    return readJson<WorkstreamArtifact>(
      this.layout().artifactFile(workstreamId, key),
    );
  }

  async create(
    workstreamId: string,
    input: CreateArtifactInput,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, input.key, async () => {
      safeWorkstreamId(workstreamId);
      validateArtifactKey(input.key);
      const ws = await this.store.getWorkstream(workstreamId);
      if (!ws) throw new Error('Workstream not found');

      const existing = await this.get(workstreamId, input.key);
      if (existing) {
        throw new Error(`Artifact "${input.key}" already exists`);
      }

      const ts = now();
      const artifact: WorkstreamArtifact = {
        schemaVersion: 1,
        id: newId('art'),
        workstreamId,
        traceId: input.traceId ?? ws.traceId,
        key: input.key,
        name: input.name,
        description: input.description,
        contentType: input.contentType,
        createdAt: ts,
        updatedAt: ts,
        approvalStatus: 'not_requested',
        visibility: input.visibility ?? 'private',
        versions: [],
      };

      await ensureDir(this.layout().artifactDir(workstreamId, input.key));
      await writeJsonAtomic(
        this.layout().artifactFile(workstreamId, input.key),
        artifact,
      );
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: artifact.id,
        data: { event: 'created', artifact: this.summary(artifact) },
      });
      return artifact;
    });
  }

  async publish(
    workstreamId: string,
    input: PublishArtifactInput,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, input.key, async () => {
      safeWorkstreamId(workstreamId);
      validateArtifactKey(input.key);
      const ws = await this.store.getWorkstream(workstreamId);
      if (!ws) throw new Error('Workstream not found');

      const contentType = input.contentType ?? 'text/markdown';
      let artifact = await this.get(workstreamId, input.key);
      if (!artifact) {
        const createdAt = now();
        artifact = {
          schemaVersion: 1,
          id: newId('art'),
          workstreamId,
          traceId: ws.traceId,
          key: input.key,
          name: input.name,
          description: input.description,
          contentType,
          createdAt,
          updatedAt: createdAt,
          approvalStatus: 'not_requested',
          visibility: 'private',
          versions: [],
        };
        await ensureDir(this.layout().artifactDir(workstreamId, input.key));
        await this.saveArtifact(artifact);
        await this.recordTrace({
          workstreamId,
          kind: 'artifact',
          sourceId: artifact.id,
          data: { event: 'created', artifact: this.summary(artifact) },
        });
      }
      if (artifact.archivedAt) {
        throw new Error('Cannot publish an archived artifact');
      }

      const content =
        typeof input.content === 'string'
          ? Buffer.from(input.content, 'utf8')
          : input.content;
      const versionId = nextVersionId(artifact);
      validateArtifactVersion(versionId);
      const versionDir = this.layout().artifactVersionDir(
        workstreamId,
        input.key,
        versionId,
      );
      assertUnderRoot(this.artifactRoot(workstreamId, input.key), versionDir);
      const contentPath = this.resolveContentPath(
        workstreamId,
        input.key,
        versionId,
      );
      const versionFile = this.layout().artifactVersionFile(
        workstreamId,
        input.key,
        versionId,
      );
      const releasedAt = now();
      const version: ArtifactVersionRecord = {
        schemaVersion: 1,
        version: versionId,
        contentType,
        sha256: sha256(content),
        byteSize: content.byteLength,
        createdAt: releasedAt,
        createdByRunId: input.createdByRunId,
        state: 'released',
        metadata: input.metadata,
        releasedAt,
      };

      await ensureDir(versionDir);
      const tmp = `${contentPath}.${process.pid}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, content);
      await fs.rename(tmp, contentPath);
      await writeJsonAtomic(versionFile, version);

      const updatedArtifact: WorkstreamArtifact = {
        ...artifact,
        contentType,
        currentVersion: versionId,
        updatedAt: releasedAt,
        versions: [...artifact.versions, version],
      };
      await this.saveArtifact(updatedArtifact);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updatedArtifact.id,
        runId: input.createdByRunId,
        data: {
          event: 'version_created',
          key: input.key,
          version: versionId,
          sha256: version.sha256,
          byteSize: version.byteSize,
        },
      });
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updatedArtifact.id,
        runId: input.createdByRunId,
        data: { event: 'version_released', key: input.key, version: versionId },
      });
      return updatedArtifact;
    });
  }

  async patch(
    workstreamId: string,
    key: string,
    patch: PatchArtifactInput,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, key, async () => {
      const artifact = await this.requireArtifact(workstreamId, key);
      if (artifact.archivedAt) {
        throw new Error('Cannot patch an archived artifact');
      }
      const updated: WorkstreamArtifact = {
        ...artifact,
        ...patch,
        updatedAt: now(),
      };
      await this.saveArtifact(updated);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updated.id,
        data: { event: 'updated', patch, artifact: this.summary(updated) },
      });
      return updated;
    });
  }

  async archive(
    workstreamId: string,
    key: string,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, key, async () => {
      const artifact = await this.requireArtifact(workstreamId, key);
      if (artifact.archivedAt) return artifact;
      const updated: WorkstreamArtifact = {
        ...artifact,
        archivedAt: now(),
        updatedAt: now(),
      };
      await this.saveArtifact(updated);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updated.id,
        data: { event: 'archived', artifact: this.summary(updated) },
      });
      return updated;
    });
  }

  async restore(
    workstreamId: string,
    key: string,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, key, async () => {
      const artifact = await this.requireArtifact(workstreamId, key);
      if (!artifact.archivedAt) return artifact;
      const updated: WorkstreamArtifact = {
        ...artifact,
        archivedAt: undefined,
        updatedAt: now(),
      };
      await this.saveArtifact(updated);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updated.id,
        data: { event: 'restored', artifact: this.summary(updated) },
      });
      return updated;
    });
  }

  async createVersion(
    workstreamId: string,
    key: string,
    input: CreateArtifactVersionInput,
  ): Promise<{
    artifact: WorkstreamArtifact;
    version: ArtifactVersionSummary;
  }> {
    return withArtifactChain(workstreamId, key, async () => {
      const artifact = await this.requireArtifact(workstreamId, key);
      if (artifact.archivedAt) {
        throw new Error('Cannot add versions to an archived artifact');
      }

      const content =
        typeof input.content === 'string'
          ? Buffer.from(input.content, 'utf8')
          : input.content;
      const hash = sha256(content);
      const byteSize = content.byteLength;
      const contentType = input.contentType ?? artifact.contentType;
      const versionId = nextVersionId(artifact);
      validateArtifactVersion(versionId);

      const versionDir = this.layout().artifactVersionDir(
        workstreamId,
        key,
        versionId,
      );
      assertUnderRoot(this.artifactRoot(workstreamId, key), versionDir);
      const contentPath = this.resolveContentPath(workstreamId, key, versionId);
      const versionFile = this.layout().artifactVersionFile(
        workstreamId,
        key,
        versionId,
      );

      if (input.idempotencyKey) {
        const match = artifact.versions.find(
          (v) => v.metadata?.idempotencyKey === input.idempotencyKey,
        );
        if (match) {
          if (match.sha256 === hash) {
            return { artifact, version: match };
          }
          throw new Error(
            `Idempotency key "${input.idempotencyKey}" already used with different content`,
          );
        }
      }

      const ts = now();
      const version: ArtifactVersionRecord = {
        schemaVersion: 1,
        version: versionId,
        contentType,
        sha256: hash,
        byteSize,
        createdAt: ts,
        createdByRunId: input.createdByRunId,
        sourceTraceSequence: input.sourceTraceSequence,
        state: 'ready',
        sourcePath: input.sourcePath,
        metadata: input.idempotencyKey
          ? { ...input.metadata, idempotencyKey: input.idempotencyKey }
          : input.metadata,
      };

      await ensureDir(versionDir);
      const tmp = `${contentPath}.${process.pid}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, content);
      await fs.rename(tmp, contentPath);
      await writeJsonAtomic(versionFile, version);

      const updatedArtifact: WorkstreamArtifact = {
        ...artifact,
        contentType,
        updatedAt: ts,
        versions: [...artifact.versions, version],
      };
      await this.saveArtifact(updatedArtifact);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updatedArtifact.id,
        runId: input.createdByRunId,
        data: {
          event: 'version_created',
          key,
          version: versionId,
          sha256: hash,
          byteSize,
        },
      });
      return { artifact: updatedArtifact, version };
    });
  }

  async getVersion(
    workstreamId: string,
    key: string,
    version: string,
  ): Promise<ArtifactVersionSummary | null> {
    validateArtifactVersion(version);
    const record = await readJson<ArtifactVersionRecord>(
      this.layout().artifactVersionFile(workstreamId, key, version),
    );
    return record;
  }

  async readVersionContent(
    workstreamId: string,
    key: string,
    version: string,
    limit?: number,
  ): Promise<{ content: Buffer; contentType: string; truncated: boolean }> {
    const versionRecord = await this.getVersion(workstreamId, key, version);
    if (!versionRecord) throw new Error('Version not found');
    const contentPath = this.resolveContentPath(workstreamId, key, version);
    const stat = await fs.stat(contentPath);
    if (limit !== undefined && stat.size > limit) {
      const handle = await fs.open(contentPath, 'r');
      try {
        const buffer = Buffer.alloc(limit);
        await handle.read(buffer, 0, limit, 0);
        return {
          content: buffer,
          contentType: versionRecord.contentType,
          truncated: true,
        };
      } finally {
        await handle.close();
      }
    }
    const content = await fs.readFile(contentPath);
    return {
      content,
      contentType: versionRecord.contentType,
      truncated: false,
    };
  }

  async requestApproval(
    workstreamId: string,
    key: string,
    version: string,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, key, async () => {
      const artifact = await this.requireArtifact(workstreamId, key);
      const versionRecord = await this.requireVersion(
        workstreamId,
        key,
        version,
      );
      if (versionRecord.state !== 'ready' && versionRecord.state !== 'draft') {
        throw new Error('Only ready or draft versions can request approval');
      }
      const updatedVersion: ArtifactVersionRecord = {
        ...(await readJson<ArtifactVersionRecord>(
          this.layout().artifactVersionFile(workstreamId, key, version),
        ))!,
        state: 'ready',
      };
      await writeJsonAtomic(
        this.layout().artifactVersionFile(workstreamId, key, version),
        updatedVersion,
      );
      const updatedArtifact: WorkstreamArtifact = {
        ...artifact,
        approvalStatus: 'pending',
        updatedAt: now(),
        versions: artifact.versions.map((v) =>
          v.version === version ? updatedVersion : v,
        ),
      };
      await this.saveArtifact(updatedArtifact);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updatedArtifact.id,
        data: { event: 'approval_requested', key, version },
      });
      return updatedArtifact;
    });
  }

  async approveVersion(
    workstreamId: string,
    key: string,
    version: string,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, key, async () => {
      const artifact = await this.requireArtifact(workstreamId, key);
      const versionRecord = await this.requireVersion(
        workstreamId,
        key,
        version,
      );
      if (versionRecord.state === 'rejected') {
        throw new Error('Cannot approve a rejected version');
      }
      const updatedVersion: ArtifactVersionRecord = {
        ...(await readJson<ArtifactVersionRecord>(
          this.layout().artifactVersionFile(workstreamId, key, version),
        ))!,
        state: 'approved',
      };
      await writeJsonAtomic(
        this.layout().artifactVersionFile(workstreamId, key, version),
        updatedVersion,
      );
      const updatedArtifact: WorkstreamArtifact = {
        ...artifact,
        approvalStatus: 'approved',
        updatedAt: now(),
        versions: artifact.versions.map((v) =>
          v.version === version ? updatedVersion : v,
        ),
      };
      await this.saveArtifact(updatedArtifact);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updatedArtifact.id,
        data: { event: 'version_approved', key, version },
      });
      return updatedArtifact;
    });
  }

  async rejectVersion(
    workstreamId: string,
    key: string,
    version: string,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, key, async () => {
      const artifact = await this.requireArtifact(workstreamId, key);
      await this.requireVersion(workstreamId, key, version);
      const updatedVersion: ArtifactVersionRecord = {
        ...(await readJson<ArtifactVersionRecord>(
          this.layout().artifactVersionFile(workstreamId, key, version),
        ))!,
        state: 'rejected',
      };
      await writeJsonAtomic(
        this.layout().artifactVersionFile(workstreamId, key, version),
        updatedVersion,
      );
      const updatedArtifact: WorkstreamArtifact = {
        ...artifact,
        approvalStatus: 'rejected',
        updatedAt: now(),
        versions: artifact.versions.map((v) =>
          v.version === version ? updatedVersion : v,
        ),
      };
      await this.saveArtifact(updatedArtifact);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updatedArtifact.id,
        data: { event: 'version_rejected', key, version },
      });
      return updatedArtifact;
    });
  }

  async releaseVersion(
    workstreamId: string,
    key: string,
    version: string,
  ): Promise<WorkstreamArtifact> {
    return withArtifactChain(workstreamId, key, async () => {
      const artifact = await this.requireArtifact(workstreamId, key);
      if (artifact.archivedAt) {
        throw new Error('Cannot release a version of an archived artifact');
      }
      const versionRecord = await this.requireVersion(
        workstreamId,
        key,
        version,
      );
      const approvalRequired =
        artifact.approvalStatus === 'pending' ||
        artifact.approvalStatus === 'approved' ||
        artifact.approvalStatus === 'rejected';
      if (approvalRequired && versionRecord.state !== 'approved') {
        throw new Error('Version must be approved before release');
      }
      if (
        !approvalRequired &&
        versionRecord.state !== 'ready' &&
        versionRecord.state !== 'approved' &&
        versionRecord.state !== 'released'
      ) {
        throw new Error('Version must be ready before release');
      }

      const releasedAt = now();
      const updatedVersion: ArtifactVersionRecord = {
        ...(await readJson<ArtifactVersionRecord>(
          this.layout().artifactVersionFile(workstreamId, key, version),
        ))!,
        state: 'released',
        releasedAt,
      };
      await writeJsonAtomic(
        this.layout().artifactVersionFile(workstreamId, key, version),
        updatedVersion,
      );
      const updatedArtifact: WorkstreamArtifact = {
        ...artifact,
        currentVersion: version,
        updatedAt: releasedAt,
        versions: artifact.versions.map((v) =>
          v.version === version ? updatedVersion : v,
        ),
      };
      await this.saveArtifact(updatedArtifact);
      await this.recordTrace({
        workstreamId,
        kind: 'artifact',
        sourceId: updatedArtifact.id,
        data: { event: 'version_released', key, version },
      });
      return updatedArtifact;
    });
  }

  private async requireArtifact(
    workstreamId: string,
    key: string,
  ): Promise<WorkstreamArtifact> {
    const artifact = await this.get(workstreamId, key);
    if (!artifact) throw new Error(`Artifact "${key}" not found`);
    return artifact;
  }

  private async requireVersion(
    workstreamId: string,
    key: string,
    version: string,
  ): Promise<ArtifactVersionSummary> {
    validateArtifactVersion(version);
    const record = await this.getVersion(workstreamId, key, version);
    if (!record) throw new Error(`Version "${version}" not found`);
    return record;
  }

  private async saveArtifact(artifact: WorkstreamArtifact): Promise<void> {
    await writeJsonAtomic(
      this.layout().artifactFile(artifact.workstreamId, artifact.key),
      artifact,
    );
  }

  private summary(artifact: WorkstreamArtifact): Record<string, unknown> {
    return {
      id: artifact.id,
      key: artifact.key,
      name: artifact.name,
      currentVersion: artifact.currentVersion,
      approvalStatus: artifact.approvalStatus,
      visibility: artifact.visibility,
      archivedAt: artifact.archivedAt,
      versionCount: artifact.versions.length,
    };
  }
}
