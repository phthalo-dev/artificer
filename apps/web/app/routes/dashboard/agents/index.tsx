import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '~/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { AGENT_STATUS_LABELS } from '@artificer/shared';
import { formatDate } from '~/lib/utils';

export const Route = createFileRoute('/dashboard/agents/')({
  component: AgentsPage,
});

function AgentsPage() {
  const { data: agents, isLoading } = trpc.agents.list.useQuery();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Agents</h1>
          <p className="text-muted-foreground">
            Manage your AI coding agents
          </p>
        </div>
        <Link to="/dashboard/agents/new">
          <Button>Create Agent</Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground">Loading agents...</div>
      ) : agents && agents.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{agent.name}</CardTitle>
                    <CardDescription>@{agent.githubUsername}</CardDescription>
                  </div>
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
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Instance:</span>
                    <span className="font-mono text-xs">
                      {agent.ec2InstanceId || 'Not provisioned'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Activity:</span>
                    <span>{agent._count.activities} events</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Created:</span>
                    <span>{formatDate(agent.createdAt)}</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Link to="/dashboard/agents/$id" params={{ id: agent.id }} className="flex-1">
                      <Button variant="outline" className="w-full" size="sm">
                        View
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-muted-foreground">
              You haven't created any agents yet
            </p>
            <Link to="/dashboard/agents/new">
              <Button>Create Your First Agent</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
