import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SpawnCallInput } from '../context.js';
import type { IdentityStore } from '../storage/identity-store.js';
import type { Store } from '../storage/store.js';
import type { Review, RunRecord, Workstream } from '../storage/types.js';
import { findGitRepo } from './git-repo.js';
import { workerRunSummary } from './worker-report.js';

const execFileAsync = promisify(execFile);

/** Soft cap for workstream chronicle bodies (32 KiB). */
export const CHRONICLE_MAX_CHARS = 32 * 1024;

function repoSlug(repoUrl: string): string {
  const last = repoUrl
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean)
    .pop();
  return last ?? '';
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Split a chronicle into the Goal preamble and `## `-headed sections.
 * The first element is everything before the first `## ` heading.
 */
export function splitChronicleSections(content: string): string[] {
  const re = /\n\n## /g;
  const indices: number[] = [0];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    indices.push(m.index);
  }
  const out: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : content.length;
    out.push(content.slice(start, end));
  }
  return out;
}

/**
 * Keep Goal + newest sections when a chronicle exceeds maxChars.
 * Drops oldest middle sections and inserts a short rollup note.
 */
export function trimChronicleContent(
  content: string,
  maxChars = CHRONICLE_MAX_CHARS,
): string {
  if (content.length <= maxChars) return content;

  const sections = splitChronicleSections(content);
  const preamble = sections[0] ?? '';
  const rest = sections.slice(1);
  if (rest.length === 0) {
    return `${content.slice(0, Math.max(0, maxChars - 20))}\n… (truncated)`;
  }

  const rollup = `\n\n## Chronicle rollup\nOlder middle sections were truncated to stay under ${maxChars} characters. Claims remain the primary recall units.\n`;
  const kept: string[] = [];
  let size = preamble.length + rollup.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    const next = rest[i];
    if (kept.length > 0 && size + next.length > maxChars) break;
    kept.unshift(next);
    size += next.length;
  }

  let result = preamble + rollup + kept.join('');
  if (result.length > maxChars) {
    result = `${result.slice(0, Math.max(0, maxChars - 20))}\n… (truncated)`;
  }
  return result;
}

/** Deterministic hash of goal + summary + status for skip-if-unchanged distill. */
export function distillSourceHash(ws: Workstream): string {
  const payload = `${ws.goal}\n${ws.summary ?? ''}\n${ws.status}`;
  return createHash('sha256').update(payload).digest('hex');
}

function buildDistillTask(
  ws: Workstream,
  chronicleId: string,
  chronicle: string,
): string {
  const excerpt = truncate(chronicle, 6000);
  return [
    'Distill this finished workstream into durable memory claims.',
    'Do NOT fetch URLs or clone repositories — use only the material below.',
    '',
    `Workstream: ${ws.title} (${ws.id})`,
    `Goal: ${ws.goal}`,
    `Status: ${ws.status}`,
    ws.summary ? `Summary: ${ws.summary}` : null,
    ws.repoUrl ? `Repository: ${ws.repoUrl}` : null,
    `Chronicle memory id: ${chronicleId}`,
    '',
    'Chronicle excerpt:',
    excerpt,
    '',
    'Rules:',
    '- Save 1–5 kind: "claim" memories (short assertion in summary; optional evidence in the body).',
    '- Optionally save kind: "entity" memories for named repos/tools/orgs referenced in the chronicle.',
    `- Each claim MUST set related: [{ id: "${chronicleId}", type: "builds_on" }] (or type "related").`,
    '- Do not invent facts without textual evidence in the goal, summary, or chronicle.',
    '- Prefer fewer claims; skip fluff and process noise.',
    '- Call query_memories before saving to avoid duplicates.',
    '- Do not re-copy preference memories; if a preference id is known, link via related only.',
    '- Finish by calling reply listing the titles of what you saved.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export type DistillSpawn = (
  input: SpawnCallInput,
) => Promise<{ runId: string; taskId?: string }>;

export class WorkstreamMemoryService {
  constructor(
    private readonly identity: IdentityStore,
    private readonly store: Store,
  ) {}

  async onCreated(ws: Workstream): Promise<void> {
    try {
      const tags = ['workstream', ws.status];
      if (ws.repoUrl) tags.push(repoSlug(ws.repoUrl));

      const content = `Goal: ${ws.goal}\n\nStatus: ${ws.status}`;
      const memory = await this.identity.addMemory({
        title: ws.title,
        content,
        tags,
        kind: 'document',
        source: `workstream:${ws.id}`,
      });
      await this.saveMemoryId(ws.id, memory.id);
    } catch (err) {
      console.error(`[workstream-memory] onCreated failed for ${ws.id}:`, err);
    }
  }

  async onPlanWritten(ws: Workstream, plan: string): Promise<void> {
    try {
      const section = `\n\n## Plan\n${truncate(plan, 1000)}`;
      await this.appendToMemory(ws.id, section);
    } catch (err) {
      console.error(
        `[workstream-memory] onPlanWritten failed for ${ws.id}:`,
        err,
      );
    }
  }

  async onWorkerRunFinished(ws: Workstream, run: RunRecord): Promise<void> {
    try {
      const summary = workerRunSummary(run) ?? truncate(run.output, 500);
      const section = `\n\n## Worker Run (${run.createdAt})\n${summary}`;
      await this.appendToMemory(ws.id, section);
    } catch (err) {
      console.error(
        `[workstream-memory] onWorkerRunFinished failed for ${ws.id}:`,
        err,
      );
    }
  }

  async onReviewCompleted(ws: Workstream, review: Review): Promise<void> {
    try {
      const outcome = review.approved ? 'approved' : 'rejected';
      const stage = review.stage ? ` (${review.stage})` : '';
      const section = `\n\n## Review${stage}\nOutcome: ${outcome} — ${truncate(review.notes, 300)}`;
      await this.appendToMemory(ws.id, section);
    } catch (err) {
      console.error(
        `[workstream-memory] onReviewCompleted failed for ${ws.id}:`,
        err,
      );
    }
  }

  async onTerminal(ws: Workstream): Promise<void> {
    try {
      const section = `\n\n## Outcome\nStatus: ${ws.status}${ws.summary ? `\n${ws.summary}` : ''}`;
      const memId = await this.getMemoryId(ws.id);
      if (!memId) return;
      const existing = await this.identity.getMemory(memId);
      if (!existing) return;
      const content = trimChronicleContent(existing.content + section);
      const sourceHash = distillSourceHash(ws);
      const sourceCommit = await this.tryRepoHead(ws);
      await this.identity.updateMemory(memId, {
        content,
        summary: ws.summary || undefined,
        sourceHash,
        sourceCommit: sourceCommit ?? undefined,
      });
    } catch (err) {
      console.error(`[workstream-memory] onTerminal failed for ${ws.id}:`, err);
    }
  }

  /**
   * Fire-and-forget librarian distill after a terminal workstream update.
   * Skips when the goal+summary+status hash matches the last distill, or when
   * the status is not a finished terminal (blocked is a pause, not a finish).
   */
  async requestDistill(
    ws: Workstream,
    spawn: DistillSpawn,
  ): Promise<{ runId: string } | null> {
    if (ws.status === 'blocked') return null;
    if (!['done', 'failed', 'cancelled'].includes(ws.status)) return null;

    const memId = await this.getMemoryId(ws.id);
    if (!memId) return null;
    const chronicle = await this.identity.getMemory(memId);
    if (!chronicle) return null;

    const hash = distillSourceHash(ws);
    const prev = await this.readDistillHash(ws.id);
    if (prev === hash) return null;

    const { runId } = await spawn({
      role: 'librarian',
      description: buildDistillTask(ws, memId, chronicle.content),
    });
    await this.saveDistillHash(ws.id, hash);
    return { runId };
  }

  private async tryRepoHead(ws: Workstream): Promise<string | null> {
    try {
      const workspaceDir = this.store.layout.workstreamWorkspace(ws.id);
      const repo = await findGitRepo(workspaceDir);
      if (!repo) return null;
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: repo,
        timeout: 10_000,
      });
      const head = stdout.trim();
      return head || null;
    } catch {
      return null;
    }
  }

  private async getMemoryId(workstreamId: string): Promise<string | null> {
    const file = this.store.layout.workstreamMemoryRefFile(workstreamId);
    try {
      return (await fs.readFile(file, 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  private async saveMemoryId(
    workstreamId: string,
    memoryId: string,
  ): Promise<void> {
    const file = this.store.layout.workstreamMemoryRefFile(workstreamId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, memoryId, 'utf-8');
  }

  private async readDistillHash(workstreamId: string): Promise<string | null> {
    const file = this.store.layout.workstreamDistillHashFile(workstreamId);
    try {
      return (await fs.readFile(file, 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  private async saveDistillHash(
    workstreamId: string,
    hash: string,
  ): Promise<void> {
    const file = this.store.layout.workstreamDistillHashFile(workstreamId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, hash, 'utf-8');
  }

  private async appendToMemory(
    workstreamId: string,
    section: string,
  ): Promise<void> {
    const memId = await this.getMemoryId(workstreamId);
    if (!memId) return;
    const existing = await this.identity.getMemory(memId);
    if (!existing) return;
    const content = trimChronicleContent(existing.content + section);
    await this.identity.updateMemory(memId, { content });
  }
}
