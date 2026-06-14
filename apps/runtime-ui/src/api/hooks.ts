import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, sendWork } from './client';
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
