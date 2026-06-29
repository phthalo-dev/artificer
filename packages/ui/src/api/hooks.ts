import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, baseOrigin, sendWork } from './client';
import type {
  BenchOverview,
  BenchRunDetail,
  BenchSuiteCatalogEntry,
  Memory,
  Message,
  MessageCost,
  ModelConfig,
  ModelTier,
  ModelTiers,
  QuotaConfig,
  QuotaConfigResponse,
  RoleName,
  RuntimeState,
  UsageOverview,
  Workstream,
  WorkstreamDetail,
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

export function useWorkstream(id: string | undefined) {
  return useQuery({
    queryKey: ['workstream', id],
    queryFn: () => api.get<WorkstreamDetail>(`/workstreams/${id}`),
    refetchInterval: 2500,
    enabled: Boolean(id),
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
      api.put<{ roleTiers: Record<RoleName, ModelTier>; activePresetId: string }>(
        '/config/role-tiers',
        roleTiers,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['model-config'] });
    },
  });
}

export function useCancelWorkstream(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>(`/workstreams/${id}/cancel`, {}),
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
    queryFn: () => api.get<{ suites: BenchSuiteCatalogEntry[] }>('/bench/suites'),
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
      api.put<QuotaConfigResponse & { quota: import('./types').QuotaSnapshot | null }>(
        '/config/quota',
        config,
      ),
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
  kind: 'message' | 'workstream' | 'run' | 'tool' | 'quota';
  label: string;
  at: string;
}

const SSE_KINDS = ['message', 'workstream', 'run', 'tool', 'quota'] as const;
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
  }

  return { id: crypto.randomUUID(), kind, label, at };
}

export function useSSEEvents(): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const qc = useQueryClient();

  useEffect(() => {
    const url = `${baseOrigin.replace(/\/$/, '')}/events`;
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
              return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
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
  kind?: 'note' | 'document' | 'preference';
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
