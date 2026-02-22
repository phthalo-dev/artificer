import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '~/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import { ACTIVITY_TYPE_LABELS } from '@artificer/shared';
import { formatRelativeTime } from '~/lib/utils';

export const Route = createFileRoute('/dashboard/activity')({
  component: ActivityPage,
});

function ActivityPage() {
  const { data: activities, isLoading } = trpc.activity.list.useQuery({
    limit: 50,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Activity</h1>
        <p className="text-muted-foreground">
          All activity from your agents
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
          <CardDescription>
            Recent actions performed by all your agents
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center text-muted-foreground">Loading...</div>
          ) : activities && activities.items.length > 0 ? (
            <div className="space-y-4">
              {activities.items.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start justify-between rounded-lg border p-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {ACTIVITY_TYPE_LABELS[activity.type]}
                      </Badge>
                      <span className="text-sm font-medium">
                        {activity.agent.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        @{activity.agent.githubUsername}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {activity.description}
                    </div>
                    {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                      <div className="mt-2">
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            View metadata
                          </summary>
                          <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-2">
                            {JSON.stringify(activity.metadata, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                  <div className="ml-4 text-xs text-muted-foreground">
                    {formatRelativeTime(activity.timestamp)}
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
  );
}
