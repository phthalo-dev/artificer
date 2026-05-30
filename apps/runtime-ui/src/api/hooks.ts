import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  Memory,
  Message,
  MessageCost,
  ModelConfig,
  ModelTiers,
  RuntimeState,
  UsageOverview,
  Workstream,
  WorkstreamDetail,
} from './types';

export function useRuntimeState() {
  return useQuery({
    queryKey: ['state'],
    queryFn: () => api.get<RuntimeState>('/state'),
    refetchInterval: 2000,
  });
}

export function useMessages() {
  return useQuery({
    queryKey: ['messages'],
    queryFn: () => api.get<{ messages: Message[] }>('/messages'),
    refetchInterval: 2000,
    select: (d) => d.messages,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api.post<{ message: Message }>('/messages', { content }),
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
    refetchInterval: 3000,
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
      api.put<{ tiers: ModelTiers }>('/config/models', tiers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['model-config'] });
    },
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
