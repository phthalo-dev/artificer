import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useRef, useEffect } from 'react';
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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function ChatPanel({ agentId }: { agentId: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const createSessionMutation = trpc.agents.createSession.useMutation();
  const sendPromptMutation = trpc.agents.sendPrompt.useMutation();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const handleSend = async () => {
    const text = prompt.trim();
    if (!text || isSending) return;

    setPrompt('');
    setError('');
    setIsSending(true);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    try {
      let sid = sessionId;
      if (!sid) {
        const session = await createSessionMutation.mutateAsync({ id: agentId });
        sid = session.id;
        setSessionId(sid);
      }

      const response = await sendPromptMutation.mutateAsync({
        id: agentId,
        sessionId: sid,
        prompt: text,
      });

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: response.content || '(no response)' },
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
      // Remove the optimistically-added user message on error
      setMessages((prev) => prev.slice(0, -1));
      setPrompt(text);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat</CardTitle>
        <CardDescription>
          Send a task to the agent — it will run OpenCode on the EC2 instance
          {sessionId && (
            <span className="ml-2 font-mono text-xs text-muted-foreground/60">
              session: {sessionId.slice(0, 8)}…
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Message history */}
        <div className="flex h-80 flex-col gap-3 overflow-y-auto rounded-lg border bg-muted/30 p-4">
          {messages.length === 0 && !isSending && (
            <p className="m-auto text-sm text-muted-foreground">
              No messages yet. Send a task to get started.
            </p>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background border'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm text-muted-foreground">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Agent is working… (may take a minute)
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            rows={3}
            placeholder="e.g. Fix the bug in src/auth.ts where tokens expire too early"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
            }}
            disabled={isSending}
          />
          <Button
            onPress={handleSend}
            isDisabled={!prompt.trim() || isSending}
            className="self-end"
          >
            Send
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">⌘↵ to send</p>
      </CardContent>
    </Card>
  );
}

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

  const [healthResult, setHealthResult] = useState<{ isHealthy: boolean; version?: string; error?: string } | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const healthQuery = trpc.agents.checkHealth.useQuery({ id }, { enabled: false });

  const handleCheckHealth = async () => {
    setIsCheckingHealth(true);
    setHealthResult(null);
    try {
      const result = await healthQuery.refetch();
      setHealthResult(result.data ?? null);
    } finally {
      setIsCheckingHealth(false);
    }
  };

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

            {agent.status === 'RUNNING' && (
              <div className="space-y-2">
                <Button
                  className="w-full"
                  variant="outline"
                  onPress={handleCheckHealth}
                  isDisabled={isCheckingHealth}
                >
                  {isCheckingHealth ? 'Checking…' : 'Check OpenCode Health'}
                </Button>
                {healthResult && (
                  <div className={`rounded-md px-3 py-2 text-sm space-y-1 ${healthResult.isHealthy ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-900'}`}>
                    {healthResult.isHealthy ? (
                      <p>OpenCode reachable — v{healthResult.version}</p>
                    ) : (
                      <>
                        <p className="font-medium">{healthResult.error}</p>
                        {healthResult.error?.includes('ECONNREFUSED') && (
                          <p className="text-xs">Port 4096 is reachable but nothing is listening — OpenCode may still be installing. Wait a few minutes and try again.</p>
                        )}
                        {healthResult.error?.includes('ETIMEDOUT') && (
                          <p className="text-xs">Connection timed out — check that your security group allows inbound TCP on port 4096.</p>
                        )}
                        {(healthResult.error?.includes('ENOTFOUND') || healthResult.error?.includes('ENETUNREACH')) && (
                          <p className="text-xs">Can't reach the host — the instance may be in a private subnet with no public IP route.</p>
                        )}
                        {!healthResult.error?.match(/ECONN|ETIMEDOUT|ENOTFOUND|ENETUNREACH/) && (
                          <p className="text-xs">The instance just reached running state — the setup script (Node.js + OpenCode install) takes 5–10 more minutes to complete.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
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

      {agent.status === 'RUNNING' && <ChatPanel agentId={id} />}

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
