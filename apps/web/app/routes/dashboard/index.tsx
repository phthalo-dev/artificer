import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '~/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { AGENT_STATUS_LABELS } from '@artificer/shared';
import { formatRelativeTime } from '~/lib/utils';

export const Route = createFileRoute('/dashboard/')({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: agents, isLoading: agentsLoading } = trpc.agents.list.useQuery();
  const { data: activities, isLoading: activitiesLoading } = trpc.activity.list.useQuery({
    limit: 10,
  });

  const runningAgents = agents?.filter((a) => a.status === 'RUNNING').length ?? 0;
  const totalAgents = agents?.length ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your AI coding agents
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAgents}</div>
            <p className="text-xs text-muted-foreground">
              {runningAgents} running
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activities?.items.length ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <Link to="/dashboard/agents/new">
              <Button className="w-full">Create Agent</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
            <CardDescription>Your active coding agents</CardDescription>
          </CardHeader>
          <CardContent>
            {agentsLoading ? (
              <div className="text-center text-muted-foreground">Loading...</div>
            ) : agents && agents.length > 0 ? (
              <div className="space-y-4">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div>
                      <div className="font-medium">{agent.name}</div>
                      <div className="text-sm text-muted-foreground">
                        @{agent.githubUsername}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
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
                      <Link to="/dashboard/agents/$id" params={{ id: agent.id }}>
                        <Button variant="outline" size="sm">
                          View
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                <p className="mb-4">No agents yet</p>
                <Link to="/dashboard/agents/new">
                  <Button>Create Your First Agent</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest actions by your agents</CardDescription>
          </CardHeader>
          <CardContent>
            {activitiesLoading ? (
              <div className="text-center text-muted-foreground">Loading...</div>
            ) : activities && activities.items.length > 0 ? (
              <div className="space-y-4">
                {activities.items.map((activity) => (
                  <div key={activity.id} className="border-b pb-4 last:border-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium">{activity.agent.name}</div>
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
      </div>
    </div>
  );
}
