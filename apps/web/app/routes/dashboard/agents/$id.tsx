import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { trpc } from '~/lib/trpc';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { AGENT_STATUS_LABELS } from '@artificer/shared';
import { formatDate, formatRelativeTime } from '~/lib/utils';
import { AgentConfigModal } from '~/components/agent-config-modal';

export const Route = createFileRoute('/dashboard/agents/$id')({
  component: AgentDetailPage,
});

function AgentDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [newRepo, setNewRepo] = useState('');

  const {
    data: agent,
    isLoading,
    refetch,
  } = trpc.agents.getById.useQuery({ id });
  const { data: activities } = trpc.activity.list.useQuery({
    agentId: id,
    limit: 20,
  });
  const { data: tokenSummary } = trpc.metrics.getTokenSummary.useQuery({
    agentId: id,
    period: 'week',
  });
  const { data: toolCalls } = trpc.metrics.getToolCalls.useQuery({
    agentId: id,
    limit: 10,
  });
  const { data: fileEdits } = trpc.metrics.getFileEdits.useQuery({
    agentId: id,
    limit: 10,
  });

  const startMutation = trpc.agents.start.useMutation();
  const stopMutation = trpc.agents.stop.useMutation();
  const deleteMutation = trpc.agents.delete.useMutation();
  const updateMutation = trpc.agents.update.useMutation();
  const updateReposMutation = trpc.agents.updateRepositories.useMutation();
  const setupWebhookMutation = trpc.agents.setupWebhook.useMutation();
  const removeWebhookMutation = trpc.agents.removeWebhook.useMutation();

  const handleStart = async () => {
    try {
      await startMutation.mutateAsync({ id });
      // Refresh agent data
      window.location.reload();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleStop = async () => {
    try {
      await stopMutation.mutateAsync({ id });
      window.location.reload();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this agent?')) {
      return;
    }

    try {
      await deleteMutation.mutateAsync({ id });
      navigate({ to: '/dashboard/agents' });
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading agent...</div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Agent not found</div>
      </div>
    );
  }

  const handleConfigSave = async (config: unknown) => {
    try {
      await updateMutation.mutateAsync({
        id,
        data: { opencodeConfig: config as Record<string, unknown> },
      });
      await refetch();
    } catch (err: any) {
      alert(err.message || 'Failed to save configuration');
    }
  };

  const handleAddRepo = async () => {
    if (!newRepo.trim()) return;
    const repoName = newRepo.trim();
    const currentRepos =
      (agent as unknown as { repositories?: string[] }).repositories || [];

    if (currentRepos.includes(repoName)) {
      alert('Repository already added');
      return;
    }

    try {
      await updateReposMutation.mutateAsync({
        id,
        repositories: [...currentRepos, repoName],
      });
      setNewRepo('');
      await refetch();
    } catch (err: any) {
      alert(err.message || 'Failed to add repository');
    }
  };

  const handleRemoveRepo = async (repo: string) => {
    const currentRepos =
      (agent as unknown as { repositories?: string[] }).repositories || [];

    try {
      if ((agent as unknown as { githubWebhookId?: string }).githubWebhookId) {
        await removeWebhookMutation.mutateAsync({
          id,
          repository: repo,
        });
      }
      await updateReposMutation.mutateAsync({
        id,
        repositories: currentRepos.filter((r) => r !== repo),
      });
      await refetch();
    } catch (err: any) {
      alert(err.message || 'Failed to remove repository');
    }
  };

  const handleSetupWebhook = async (repo: string) => {
    try {
      await setupWebhookMutation.mutateAsync({
        id,
        repository: repo,
      });
      await refetch();
      alert('Webhook configured successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to setup webhook');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{agent.name}</h1>
          <p className="text-muted-foreground">@{agent.githubUsername}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onPress={() => setIsConfigOpen(true)}>
            Configure
          </Button>
          <Badge
            variant={
              agent.status === 'RUNNING'
                ? 'success'
                : agent.status === 'ERROR'
                  ? 'destructive'
                  : 'secondary'
            }
          >
            {AGENT_STATUS_LABELS[agent.status]}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Agent details and settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">
                Status
              </div>
              <div className="mt-1">
                <Badge
                  variant={
                    agent.status === 'RUNNING'
                      ? 'success'
                      : agent.status === 'ERROR'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {AGENT_STATUS_LABELS[agent.status]}
                </Badge>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-muted-foreground">
                EC2 Instance
              </div>
              <div className="mt-1 font-mono text-sm">
                {agent.ec2InstanceId || 'Not provisioned'}
              </div>
            </div>

            {agent.ec2PublicIp && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">
                  Public IP
                </div>
                <div className="mt-1 font-mono text-sm">
                  {agent.ec2PublicIp}
                </div>
              </div>
            )}

            <div>
              <div className="text-sm font-medium text-muted-foreground">
                GitHub Username
              </div>
              <div className="mt-1">@{agent.githubUsername}</div>
            </div>

            <div>
              <div className="text-sm font-medium text-muted-foreground">
                Created
              </div>
              <div className="mt-1">{formatDate(agent.createdAt)}</div>
            </div>

            <div>
              <div className="text-sm font-medium text-muted-foreground">
                Last Updated
              </div>
              <div className="mt-1">{formatDate(agent.updatedAt)}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>GitHub Repositories</CardTitle>
            <CardDescription>
              Configure which repositories this agent handles
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add repositories to enable GitHub webhook integration. When issues
              or PRs are updated in these repos, the agent will be notified.
            </p>

            <div className="flex gap-2">
              <Input
                placeholder="owner/repository"
                value={newRepo}
                onChange={(e) => setNewRepo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRepo()}
              />
              <Button
                onPress={handleAddRepo}
                isDisabled={!newRepo.trim() || updateReposMutation.isPending}
              >
                Add
              </Button>
            </div>

            <div className="space-y-2">
              {(
                agent as unknown as { repositories?: string[] }
              ).repositories?.map((repo) => {
                const hasWebhook = (
                  agent as unknown as { githubWebhookId?: string }
                ).githubWebhookId;
                return (
                  <div key={repo} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <svg
                          className="h-5 w-5"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        <span className="font-mono text-sm">{repo}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasWebhook ? (
                          <Badge variant="success" className="text-xs">
                            Webhook Active
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onPress={() => handleSetupWebhook(repo)}
                            isDisabled={setupWebhookMutation.isPending}
                          >
                            Setup Webhook
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onPress={() => handleRemoveRepo(repo)}
                          isDisabled={updateReposMutation.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    {hasWebhook && (
                      <div className="text-xs text-muted-foreground">
                        Webhook is configured. GitHub events will trigger this
                        agent.
                      </div>
                    )}
                  </div>
                );
              })}

              {(!(agent as unknown as { repositories?: string[] })
                .repositories ||
                (agent as unknown as { repositories?: string[] }).repositories
                  .length === 0) && (
                <div className="text-center text-muted-foreground py-4">
                  No repositories configured
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>Manage agent lifecycle</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {agent.status === 'STOPPED' && (
              <Button
                className="w-full"
                onPress={handleStart}
                isDisabled={startMutation.isPending}
              >
                {startMutation.isPending ? 'Starting...' : 'Start Agent'}
              </Button>
            )}

            {agent.status === 'RUNNING' && (
              <Button
                className="w-full"
                variant="outline"
                onPress={handleStop}
                isDisabled={stopMutation.isPending}
              >
                {stopMutation.isPending ? 'Stopping...' : 'Stop Agent'}
              </Button>
            )}

            <Button
              className="w-full"
              variant="destructive"
              onPress={handleDelete}
              isDisabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Agent'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Token Usage</CardTitle>
            <CardDescription>Cost and usage for the past week</CardDescription>
          </CardHeader>
          <CardContent>
            {tokenSummary ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-muted p-3">
                    <div className="text-sm text-muted-foreground">
                      Total Cost
                    </div>
                    <div className="text-2xl font-bold">
                      ${tokenSummary.totalCost.toFixed(4)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <div className="text-sm text-muted-foreground">
                      Total Requests
                    </div>
                    <div className="text-2xl font-bold">
                      {tokenSummary.totalRequests}
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <div className="text-sm text-muted-foreground">
                      Input Tokens
                    </div>
                    <div className="text-xl font-semibold">
                      {tokenSummary.totalInputTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <div className="text-sm text-muted-foreground">
                      Output Tokens
                    </div>
                    <div className="text-xl font-semibold">
                      {tokenSummary.totalOutputTokens.toLocaleString()}
                    </div>
                  </div>
                </div>
                {tokenSummary.byModel.length > 0 && (
                  <div>
                    <div className="text-sm font-medium mb-2">By Model</div>
                    <div className="space-y-2">
                      {tokenSummary.byModel.map((m) => (
                        <div
                          key={m.model}
                          className="flex justify-between text-sm"
                        >
                          <span className="text-muted-foreground">
                            {m.model}
                          </span>
                          <span>${m.costUSD.toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                No usage data yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Tool Calls</CardTitle>
            <CardDescription>Tools the agent has used</CardDescription>
          </CardHeader>
          <CardContent>
            {toolCalls && toolCalls.length > 0 ? (
              <div className="space-y-2">
                {toolCalls.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center justify-between border-b pb-2 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          call.status === 'COMPLETED'
                            ? 'success'
                            : call.status === 'FAILED'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {call.status}
                      </Badge>
                      <span className="font-mono text-sm">{call.toolName}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {call.durationMs ? `${call.durationMs}ms` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                No tool calls yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent File Changes</CardTitle>
            <CardDescription>
              Files created or modified by the agent
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fileEdits && fileEdits.length > 0 ? (
              <div className="space-y-2">
                {fileEdits.map((edit) => (
                  <div
                    key={edit.id}
                    className="flex items-center justify-between border-b pb-2 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          edit.operation === 'CREATE'
                            ? 'success'
                            : edit.operation === 'DELETE'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {edit.operation}
                      </Badge>
                      <span className="font-mono text-sm">{edit.filePath}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(edit.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                No file changes yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
          <CardDescription>
            Recent actions performed by this agent
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activities && activities.items.length > 0 ? (
            <div className="space-y-4">
              {activities.items.map((activity) => (
                <div key={activity.id} className="border-b pb-4 last:border-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{activity.type}</div>
                      <div className="text-sm text-muted-foreground">
                        {activity.description}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(activity.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground">
              No activity yet
            </div>
          )}
        </CardContent>
      </Card>

      <AgentConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        onSave={handleConfigSave}
        currentConfig={(agent.opencodeConfig as Record<string, unknown>) || {}}
        isRunning={agent.status === 'RUNNING'}
      />
    </div>
  );
}
