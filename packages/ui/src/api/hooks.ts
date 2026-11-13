import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, baseOrigin, fetchArtifactContent, sendWork } from './client';
import { getApiKey } from './auth';
import type {
  BenchOverview,
  BenchRunDetail,
  BenchSuiteCatalogEntry,
  ExecutorConfig,
  ExecutorOption,
  Memory,
  Message,
  MessageCost,
  ModelConfig,
  ModelTier,
  ModelTiers,
  QuotaConfig,
  QuotaConfigResponse,
  RepoConfig,
  RoleName,
  RuntimeState,
  UsageOverview,
  Workstream,
  WorkstreamArtifact,
  WorkstreamDetail,
  WorkstreamReceiptResponse,
  WorkstreamTraceResponse,
} from './types';

export function useRuntimeState() {
  return useQuery({
    queryKey: ['state'],
    queryFn: () => api.get<RuntimeState>('/state'),
    refetchInterval: (query) => (query.state.error ? 10_000 : 2000),
    retry: 2,
  });
}

export function useMessages() {
  return useQuery({
    queryKey: ['messages'],
    queryFn: () => api.get<{ messages: Message[] }>('/messages'),
    refetchInterval: (query) => (query.state.error ? 10_000 : 2000),
    retry: 2,
    select: (d) => d.messages,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => sendWork(content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['state'] });
    },
  });
}

export function useWorkstreams() {
  return useQuery({
    queryKey: ['workstreams'],
    queryFn: () => api.get<{ workstreams: Workstream[] }>('/workstreams'),
    refetchInterval: (query) => (query.state.error ? 10_000 : 3000),
    retry: 2,
    select: (d) => d.workstreams,
  });
}

export function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: () => api.get<{ repos: RepoConfig[] }>('/repos'),
    select: (d) => d.repos,
  });
}

export function useExecutors() {
  return useQuery({
    queryKey: ['executors'],
    queryFn: () => api.get<{ executors: ExecutorOption[] }>('/executors'),
    select: (d) => d.executors,
  });
}

export interface CreateWorkstreamInput {
  driver: 'conversation';
  title: string;
  goal: string;
  repoId: string;
  executor?: ExecutorConfig;
  message?: string;
}

export function useCreateWorkstream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkstreamInput) =>
      api.post<{ workstream: Workstream; messageId?: string }>(
        '/workstreams',
        input,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workstreams'] });
    },
  });
}

export function useWorkstream(id: string | undefined) {
  return useQuery({
    queryKey: ['workstream', id],
    queryFn: () => api.get<WorkstreamDetail>(`/workstreams/${id}`),
    refetchInterval: 2500,
    enabled: Boolean(id),
  });
}

export function useWorkstreamMessages(id: string | undefined) {
  return useQuery({
    queryKey: ['workstream-messages', id],
    queryFn: () =>
      api.get<{ messages: Message[] }>(`/workstreams/${id}/messages`),
    refetchInterval: 2000,
    enabled: Boolean(id),
    select: (d) => d.messages,
  });
}

export function usePostWorkstreamMessage(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api.post<{ message: Message }>(`/workstreams/${id}/messages`, {
        content,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workstream-messages', id] });
      qc.invalidateQueries({ queryKey: ['workstream', id] });
    },
  });
}

export function useMarkWorkstreamDone(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>(`/workstreams/${id}/done`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workstream', id] });
      qc.invalidateQueries({ queryKey: ['workstreams'] });
      qc.invalidateQueries({ queryKey: ['workstream-messages', id] });
    },
  });
}

export function useRemoveWorktree(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { force?: boolean } = {}) =>
      api.post<{ ok: boolean }>(`/workstreams/${id}/worktree/remove`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workstream', id] });
    },
  });
}

export function useWorkstreamReceipt(id: string | undefined) {
  return useQuery({
    queryKey: ['workstream-receipt', id],
    queryFn: () =>
      api.get<WorkstreamReceiptResponse>(`/workstreams/${id}/receipt`),
    refetchInterval: 3000,
    enabled: Boolean(id),
  });
}

export function useWorkstreamTrace(id: string | undefined) {
  return useQuery({
    queryKey: ['workstream-trace', id],
    queryFn: () => api.get<WorkstreamTraceResponse>(`/workstreams/${id}/trace`),
    refetchInterval: 3000,
    enabled: Boolean(id),
  });
}

export function useWorkstreamArtifacts(id: string | undefined) {
  return useQuery({
    queryKey: ['workstream-artifacts', id],
    queryFn: () =>
      api.get<{ artifacts: WorkstreamArtifact[] }>(
        `/workstreams/${id}/artifacts`,
      ),
    refetchInterval: 5000,
    enabled: Boolean(id),
    select: (d) => d.artifacts,
  });
}

export function useArtifactContent(
  workstreamId: string | undefined,
  key: string | undefined,
  version: string | undefined,
) {
  return useQuery({
    queryKey: ['artifact-content', workstreamId, key, version],
    queryFn: () => fetchArtifactContent(workstreamId!, key!, version!),
    enabled: Boolean(workstreamId && key && version),
  });
}

export function useApproveArtifactVersion(
  workstreamId: string | undefined,
  key: string | undefined,
  version: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ artifact: WorkstreamArtifact }>(
        `/workstreams/${workstreamId}/artifacts/${key}/versions/${version}/approve`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['workstream-artifacts', workstreamId],
      });
    },
  });
}

export function useReleaseArtifactVersion(
  workstreamId: string | undefined,
  key: string | undefined,
  version: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ artifact: WorkstreamArtifact }>(
        `/workstreams/${workstreamId}/artifacts/${key}/versions/${version}/release`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['workstream-artifacts', workstreamId],
      });
    },
  });
}

export function useRequestArtifactApproval(
  workstreamId: string | undefined,
  key: string | undefined,
  version: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ artifact: WorkstreamArtifact }>(
        `/workstreams/${workstreamId}/artifacts/${key}/versions/${version}/request-approval`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['workstream-artifacts', workstreamId],
      });
    },
  });
}

export function useUsage() {
  return useQuery({
    queryKey: ['usage'],
    queryFn: () => api.get<UsageOverview>('/usage'),
    refetchInterval: 5000,
  });
}

export function useMessageCost(id: string | undefined) {
  return useQuery({
    queryKey: ['message-cost', id],
    queryFn: () => api.get<MessageCost>(`/messages/${id}/cost`),
    refetchInterval: 3000,
    enabled: Boolean(id),
  });
}

export function useModelConfig() {
  return useQuery({
    queryKey: ['model-config'],
    queryFn: () => api.get<ModelConfig>('/config/models'),
  });
}

export function useUpdateModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tiers: Partial<ModelTiers>) =>
      api.put<{ tiers: ModelTiers; activePresetId: string }>(
        '/config/models',
        tiers,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['model-config'] });
    },
  });
}

export function useApplyPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (presetId: string) =>
      api.put<{
        presetId: string;
        name: string;
        tiers: ModelTiers;
        roleTiers: Record<RoleName, ModelTier>;
        activePresetId: string;
      }>('/config/preset', { presetId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['model-config'] });
    },
  });
}

export function useUpdateRoleTiers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleTiers: Partial<Record<RoleName, ModelTier>>) =>
      api.put<{
        roleTiers: Record<RoleName, ModelTier>;
        activePresetId: string;
      }>('/config/role-tiers', roleTiers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['model-config'] });
    },
  });
}

export function useCancelWorkstream(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean }>(`/workstreams/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workstream', id] });
      qc.invalidateQueries({ queryKey: ['workstreams'] });
    },
  });
}

export function useBenchRuns() {
  return useQuery({
    queryKey: ['bench-runs'],
    queryFn: () => api.get<BenchOverview>('/bench/runs'),
    refetchInterval: 5000,
    retry: false,
  });
}

export function useBenchSuites() {
  return useQuery({
    queryKey: ['bench-suites'],
    queryFn: () =>
      api.get<{ suites: BenchSuiteCatalogEntry[] }>('/bench/suites'),
    select: (d) => d.suites,
    staleTime: 60_000,
  });
}

export function useBenchRun(instanceId: string | undefined) {
  return useQuery({
    queryKey: ['bench-run', instanceId],
    queryFn: () => api.get<BenchRunDetail>(`/bench/runs/${instanceId}`),
    enabled: Boolean(instanceId),
    refetchInterval: 5000,
    retry: false,
  });
}

export function useResetQuotaWindow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      accountId: string;
      windowId: string;
      workstreamId?: string;
    }) =>
      api.post<{ ok: boolean; quota: import('./types').QuotaSnapshot | null }>(
        '/quota/reset',
        input,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['usage'] });
      qc.invalidateQueries({ queryKey: ['workstreams'] });
      qc.invalidateQueries({ queryKey: ['workstream'] });
    },
  });
}

export function useQuotaConfig() {
  return useQuery({
    queryKey: ['quota-config'],
    queryFn: () => api.get<QuotaConfigResponse>('/config/quota'),
  });
}

export function useUpdateQuotaConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: QuotaConfig) =>
      api.put<
        QuotaConfigResponse & { quota: import('./types').QuotaSnapshot | null }
      >('/config/quota', config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quota-config'] });
      qc.invalidateQueries({ queryKey: ['model-config'] });
      qc.invalidateQueries({ queryKey: ['usage'] });
      qc.invalidateQueries({ queryKey: ['workstreams'] });
      qc.invalidateQueries({ queryKey: ['workstream'] });
    },
  });
}

export interface ActivityEntry {
  id: string;
  kind: 'message' | 'workstream' | 'run' | 'tool' | 'quota' | 'approval';
  label: string;
  at: string;
}

const SSE_KINDS = [
  'message',
  'workstream',
  'run',
  'tool',
  'quota',
  'approval',
] as const;
const MAX_ENTRIES = 100;

function formatEntry(
  raw: Record<string, unknown>,
  kind: ActivityEntry['kind'],
): ActivityEntry | null {
  const data = (raw.data ?? {}) as Record<string, unknown>;
  const at = String(raw.at ?? new Date().toISOString());

  let label: string;
  switch (kind) {
    case 'message':
      if (data.direction !== 'inbound') return null;
      label = '→ message received';
      break;
    case 'workstream':
      label = `workstream:${String(data.status ?? '?')} "${String(data.title ?? '')}"`;
      break;
    case 'run':
      label = `run:${String(data.status ?? '?')} ${String(data.role ?? '')}`;
      break;
    case 'tool':
      label = `tool ${String(data.name ?? '')}`;
      break;
    case 'quota': {
      const event = String(data.event ?? '?');
      const resumesAt = data.resumesAt;
      if (event === 'exhausted') {
        label = resumesAt
          ? `quota exhausted · resumes ${String(resumesAt)}`
          : 'quota exhausted';
      } else if (event === 'failover_active') {
        label = 'quota · failover active';
      } else if (event === 'failover_cleared') {
        label = 'quota · back on primary';
      } else if (event === 'resumed') {
        label = 'quota · work resumed';
      } else if (event === 'warning') {
        label = 'quota warning';
      } else {
        label = `quota:${event}`;
      }
      break;
    }
    case 'approval':
      label = `approval ${String(data.tool ?? '')} ${String(data.approvalKey ?? '')}`;
      break;
  }

  return { id: crypto.randomUUID(), kind, label, at };
}

export function useSSEEvents(): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const qc = useQueryClient();

  useEffect(() => {
    const key = getApiKey();
    const eventsBase = `${baseOrigin.replace(/\/$/, '')}/events`;
    const url = key
      ? `${eventsBase}?key=${encodeURIComponent(key)}`
      : eventsBase;
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    function connect() {
      es = new EventSource(url);

      for (const kind of SSE_KINDS) {
        es.addEventListener(kind, (e: MessageEvent) => {
          try {
            const raw = JSON.parse(e.data) as Record<string, unknown>;
            const entry = formatEntry(raw, kind);
            if (!entry) return;
            setEntries((prev) => {
              const next = [...prev, entry];
              return next.length > MAX_ENTRIES
                ? next.slice(-MAX_ENTRIES)
                : next;
            });
            if (kind === 'quota') {
              qc.invalidateQueries({ queryKey: ['usage'] });
              qc.invalidateQueries({ queryKey: ['workstreams'] });
            }
          } catch {
            // ignore malformed events
          }
        });
      }

      es.onerror = () => {
        es.close();
        if (!closed) reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      es.close();
    };
  }, [qc]);

  return entries;
}

export function useMemories(q?: string) {
  return useQuery({
    queryKey: ['memories', q ?? ''],
    queryFn: () =>
      api.get<{ memories: Memory[] }>(
        `/memories${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
    refetchInterval: 5000,
    select: (d) => d.memories,
  });
}

export interface CreateMemoryInput {
  content: string;
  title?: string;
  summary?: string;
  tags?: string[];
  source?: string;
  kind?: 'note' | 'document' | 'preference' | 'claim' | 'entity';
  related?: Array<{
    id: string;
    type?:
      | 'related'
      | 'builds_on'
      | 'contradicts'
      | 'cites'
      | 'categorized_under';
  }>;
}

export function useCreateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMemoryInput) =>
      api.post<{ memory: Memory }>('/memories', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memories'] });
    },
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/memories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memories'] });
    },
  });
}
