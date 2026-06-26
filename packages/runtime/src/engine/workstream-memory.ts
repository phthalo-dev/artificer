import fs from 'node:fs/promises';
import path from 'node:path';
import type { IdentityStore } from '../storage/identity-store.js';
import type { Store } from '../storage/store.js';
import type { Review, RunRecord, Workstream } from '../storage/types.js';
import { workerRunSummary } from './worker-report.js';

function repoSlug(repoUrl: string): string {
  const last = repoUrl.replace(/\.git$/, '').split('/').filter(Boolean).pop();
  return last ?? '';
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

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
      console.error(`[workstream-memory] onPlanWritten failed for ${ws.id}:`, err);
    }
  }

  async onWorkerRunFinished(ws: Workstream, run: RunRecord): Promise<void> {
    try {
      const summary = workerRunSummary(run) ?? truncate(run.output, 500);
      const section = `\n\n## Worker Run (${run.createdAt})\n${summary}`;
      await this.appendToMemory(ws.id, section);
    } catch (err) {
      console.error(`[workstream-memory] onWorkerRunFinished failed for ${ws.id}:`, err);
    }
  }

  async onReviewCompleted(ws: Workstream, review: Review): Promise<void> {
    try {
      const outcome = review.approved ? 'approved' : 'rejected';
      const stage = review.stage ? ` (${review.stage})` : '';
      const section = `\n\n## Review${stage}\nOutcome: ${outcome} — ${truncate(review.notes, 300)}`;
      await this.appendToMemory(ws.id, section);
    } catch (err) {
      console.error(`[workstream-memory] onReviewCompleted failed for ${ws.id}:`, err);
    }
  }

  async onTerminal(ws: Workstream): Promise<void> {
    try {
      const section = `\n\n## Outcome\nStatus: ${ws.status}${ws.summary ? `\n${ws.summary}` : ''}`;
      const memId = await this.getMemoryId(ws.id);
      if (!memId) return;
      const existing = await this.identity.getMemory(memId);
      if (!existing) return;
      await this.identity.updateMemory(memId, {
        content: existing.content + section,
        summary: ws.summary || undefined,
      });
    } catch (err) {
      console.error(`[workstream-memory] onTerminal failed for ${ws.id}:`, err);
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

  private async saveMemoryId(workstreamId: string, memoryId: string): Promise<void> {
    const file = this.store.layout.workstreamMemoryRefFile(workstreamId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, memoryId, 'utf-8');
  }

  private async appendToMemory(workstreamId: string, section: string): Promise<void> {
    const memId = await this.getMemoryId(workstreamId);
    if (!memId) return;
    const existing = await this.identity.getMemory(memId);
    if (!existing) return;
    await this.identity.updateMemory(memId, {
      content: existing.content + section,
    });
  }
}
