import type {
  Memory,
  Message,
  ModelConfig,
  QuotaConfig,
  Workstream,
  WorkstreamArtifact,
  WorkstreamDetail,
  WorkstreamReceiptResponse,
  WorkstreamTraceResponse,
} from '../api/types';
import { emptyUsageSummary } from '../utils/usage';
import {
  buildUsageOverview,
  mockArtifactContent,
  mockArtifacts,
  mockBenchOverview,
  mockBenchRunDetail,
  mockBenchSuites,
  mockMemories,
  mockMessages,
  mockModelConfig,
  mockQuotaConfig,
  mockQuotaSnapshot,
  mockReceipts,
  mockTraces,
  mockWorkstreamDetails,
  mockWorkstreams,
} from './data';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MockStore {
  messages: Message[] = clone(mockMessages);
  workstreams: Workstream[] = clone(mockWorkstreams);
  workstreamDetails: Record<string, WorkstreamDetail> = clone(
    mockWorkstreamDetails,
  );
  memories: Memory[] = clone(mockMemories);
  modelConfig: ModelConfig = clone(mockModelConfig);
  quotaConfig: QuotaConfig = clone(mockQuotaConfig);

  getState() {
    return {
      agentName: 'Artificer (mock)',
      busy: true,
      queue: { pending: 1, running: 1 },
      activeRuns: [
        {
          runId: 'run-worker-1',
          role: 'worker',
          workstreamId: this.workstreams[0].id,
          startedAt: new Date().toISOString(),
        },
      ],
      workstreams: this.workstreams.map(
        ({ id, title, status, summary, updatedAt }) => ({
          id,
          title,
          status,
          summary,
          updatedAt,
        }),
      ),
    };
  }

  getUsageOverview() {
    return buildUsageOverview(this.messages, this.workstreamDetails);
  }

  resetQuotaWindow(accountId: string, windowId: string): boolean {
    const account = mockQuotaSnapshot.accounts[accountId];
    const window = account?.windows.find((w) => w.config.id === windowId);
    if (!window) return false;
    window.used = 0;
    window.rollingEntries = [];
    window.usedByWorkstream = {};
    if (account) account.status = 'ok';
    return true;
  }

  getQuotaConfig() {
    return {
      configured: this.quotaConfig,
      effective: this.quotaConfig,
      primaryAccountId: 'opencode-go',
      catalog: this.modelConfig.catalog,
      presets: this.modelConfig.presets,
    };
  }

  updateQuotaConfig(config: QuotaConfig) {
    this.quotaConfig = clone(config);
    mockQuotaSnapshot.reservePercent = config.reservePercent ?? 10;
    for (const route of config.routes ?? []) {
      const state = mockQuotaSnapshot.accounts[route.accountId];
      if (!state) continue;
      state.config = {
        id: route.accountId,
        mode: route.mode,
        windows: route.windows,
        onExhausted: 'wait',
      };
      for (const window of route.windows) {
        const existing = state.windows.find((w) => w.config.id === window.id);
        if (existing) {
          existing.config = { ...existing.config, ...window };
        }
      }
    }
    return this.getQuotaConfig();
  }

  getMessageCost(messageId: string) {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message) return null;
    const detail = message.workstreamId
      ? this.workstreamDetails[message.workstreamId]
      : undefined;
    const runs =
      detail?.runs.filter((r) => r.originMessageId === messageId) ?? [];
    const tree = detail?.tree ?? [];
    return {
      message,
      total: detail?.usage.total ?? emptyUsageSummary(),
      byWorkstream: message.workstreamId
        ? { [message.workstreamId]: detail!.usage.total }
        : {},
      byRole: detail?.usage.byRole ?? {},
      tree: runs.length > 0 ? tree : [],
    };
  }

  addMessage(content: string): Message {
    const message: Message = {
      id: `msg-${Date.now()}`,
      direction: 'inbound',
      content,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(message);
    const reply: Message = {
      id: `msg-out-${Date.now()}`,
      direction: 'outbound',
      content: `[Mock] Received: "${content.slice(0, 80)}${content.length > 80 ? '…' : ''}"`,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(reply);
    return message;
  }

  cancelWorkstream(id: string): boolean {
    const ws = this.workstreams.find((w) => w.id === id);
    const detail = this.workstreamDetails[id];
    if (!ws || !detail) return false;
    if (['done', 'failed', 'cancelled'].includes(ws.status)) return false;
    ws.status = 'cancelled';
    ws.updatedAt = new Date().toISOString();
    detail.workstream.status = 'cancelled';
    detail.workstream.updatedAt = ws.updatedAt;
    return true;
  }

  addMemory(input: {
    content: string;
    title?: string;
    summary?: string;
    tags?: string[];
    source?: string;
    kind?: Memory['kind'];
  }): Memory {
    const memory: Memory = {
      id: `mem-${Date.now()}`,
      content: input.content,
      title: input.title,
      summary: input.summary,
      tags: input.tags ?? [],
      source: input.source,
      kind: input.kind,
      createdAt: new Date().toISOString(),
    };
    this.memories.unshift(memory);
    return memory;
  }

  deleteMemory(id: string): boolean {
    const before = this.memories.length;
    this.memories = this.memories.filter((m) => m.id !== id);
    return this.memories.length < before;
  }

  searchMemories(q: string): Memory[] {
    const needle = q.toLowerCase();
    return this.memories.filter(
      (m) =>
        m.content.toLowerCase().includes(needle) ||
        m.title?.toLowerCase().includes(needle) ||
        m.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }

  getBenchOverview() {
    return mockBenchOverview;
  }

  getBenchSuites() {
    return mockBenchSuites;
  }

  getWorkstreamTrace(workstreamId: string): WorkstreamTraceResponse | null {
    const trace = mockTraces[workstreamId];
    return trace ? clone(trace) : null;
  }

  getWorkstreamReceipt(workstreamId: string): WorkstreamReceiptResponse | null {
    const receipt = mockReceipts[workstreamId];
    return receipt ? clone(receipt) : null;
  }

  listArtifacts(workstreamId: string): WorkstreamArtifact[] {
    return clone(mockArtifacts[workstreamId] ?? []);
  }

  getArtifact(workstreamId: string, key: string): WorkstreamArtifact | null {
    const artifact = this.listArtifacts(workstreamId).find(
      (a) => a.key === key,
    );
    return artifact ? clone(artifact) : null;
  }

  getArtifactContent(
    workstreamId: string,
    key: string,
    version: string,
  ): { content: string; contentType: string } | null {
    const content = mockArtifactContent[`${workstreamId}:${key}:${version}`];
    const artifact = this.getArtifact(workstreamId, key);
    const versionRecord = artifact?.versions.find((v) => v.version === version);
    if (!content || !versionRecord) return null;
    return { content, contentType: versionRecord.contentType };
  }

  requestArtifactApproval(
    workstreamId: string,
    key: string,
  ): WorkstreamArtifact | null {
    const artifacts = mockArtifacts[workstreamId];
    if (!artifacts) return null;
    const artifact = artifacts.find((a) => a.key === key);
    if (!artifact) return null;
    artifact.approvalStatus = 'pending';
    return clone(artifact);
  }

  approveArtifactVersion(
    workstreamId: string,
    key: string,
    version: string,
  ): WorkstreamArtifact | null {
    const artifact = mockArtifacts[workstreamId]?.find((a) => a.key === key);
    if (!artifact) return null;
    const versionRecord = artifact.versions.find((v) => v.version === version);
    if (!versionRecord) return null;
    artifact.approvalStatus = 'approved';
    versionRecord.state = 'approved';
    return clone(artifact);
  }

  releaseArtifactVersion(
    workstreamId: string,
    key: string,
    version: string,
  ): WorkstreamArtifact | null {
    const artifact = mockArtifacts[workstreamId]?.find((a) => a.key === key);
    if (!artifact) return null;
    const versionRecord = artifact.versions.find((v) => v.version === version);
    if (!versionRecord) return null;
    if (
      versionRecord.state !== 'approved' &&
      artifact.approvalStatus !== 'approved'
    ) {
      throw new Error('Version must be approved before release');
    }
    versionRecord.state = 'released';
    versionRecord.releasedAt = new Date().toISOString();
    artifact.currentVersion = version;
    return clone(artifact);
  }

  getBenchRun(instanceId: string) {
    if (instanceId === mockBenchRunDetail.instanceId) return mockBenchRunDetail;
    const row = mockBenchOverview.instances.find(
      (i) => i.instanceId === instanceId,
    );
    if (!row) return null;
    return {
      ...mockBenchRunDetail,
      instanceId: row.instanceId,
      repo: row.repo,
      resolved: row.resolved,
      outcome: row.outcome,
      durationMs: row.durationMs,
      patchBytes: row.patchBytes,
      usage: {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        requests: row.runs,
        runs: row.runs,
        costUsd: row.costUsd,
      },
      trajectory: row.hasTrajectory ? mockBenchRunDetail.trajectory : null,
      patch: row.resolved ? mockBenchRunDetail.patch : null,
      verifier: {
        status: row.resolved ? ('resolved' as const) : ('unresolved' as const),
        note: row.resolved ? 'All tests passed' : 'Tests failed',
      },
    };
  }
}

export const mockStore = new MockStore();
