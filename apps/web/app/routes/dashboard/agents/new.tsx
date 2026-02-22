import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { trpc } from '~/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { TextField } from 'react-aria-components';

export const Route = createFileRoute('/dashboard/agents/new')({
  component: NewAgentPage,
});

function NewAgentPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [githubUsername, setGithubUsername] = useState('');
  const [githubEmail, setGithubEmail] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [error, setError] = useState('');

  const createMutation = trpc.agents.create.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const agent = await createMutation.mutateAsync({
        name,
        githubUsername,
        githubEmail,
        githubToken,
        anthropicApiKey,
      });

      navigate({ to: '/dashboard/agents/$id', params: { id: agent.id } });
    } catch (err: any) {
      setError(err.message || 'Failed to create agent');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Create New Agent</h1>
        <p className="text-muted-foreground">
          Set up a new AI coding agent with its own GitHub identity
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Agent Configuration</CardTitle>
          <CardDescription>
            Configure your agent's identity and credentials
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <TextField className="space-y-2">
              <Label>Agent Name</Label>
              <Input
                placeholder="e.g., My Coding Agent"
                value={name}
                onChange={(e) => setName(e.target.value)}
                isRequired
              />
              <p className="text-xs text-muted-foreground">
                A friendly name for your agent
              </p>
            </TextField>

            <div className="space-y-4 rounded-lg border p-4">
              <h3 className="font-semibold">GitHub Configuration</h3>

              <TextField className="space-y-2">
                <Label>GitHub Username</Label>
                <Input
                  placeholder="e.g., my-agent-bot"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  isRequired
                />
                <p className="text-xs text-muted-foreground">
                  The GitHub username for this agent
                </p>
              </TextField>

              <TextField className="space-y-2">
                <Label>GitHub Email</Label>
                <Input
                  type="email"
                  placeholder="agent@example.com"
                  value={githubEmail}
                  onChange={(e) => setGithubEmail(e.target.value)}
                  isRequired
                />
                <p className="text-xs text-muted-foreground">
                  Email associated with the GitHub account
                </p>
              </TextField>

              <TextField className="space-y-2">
                <Label>GitHub Personal Access Token</Label>
                <Input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxx"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  isRequired
                />
                <p className="text-xs text-muted-foreground">
                  A GitHub PAT with repo access (will be encrypted)
                </p>
              </TextField>
            </div>

            <TextField className="space-y-2">
              <Label>Anthropic API Key</Label>
              <Input
                type="password"
                placeholder="sk-ant-xxxxxxxxxxxx"
                value={anthropicApiKey}
                onChange={(e) => setAnthropicApiKey(e.target.value)}
                isRequired
              />
              <p className="text-xs text-muted-foreground">
                Your Anthropic API key for Claude (will be encrypted)
              </p>
            </TextField>

            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onPress={() => navigate({ to: '/dashboard/agents' })}
                isDisabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" isDisabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Agent'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-2xl border-yellow-200 bg-yellow-50">
        <CardHeader>
          <CardTitle className="text-base">Important Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            <li>All credentials are encrypted before storage</li>
            <li>The agent will be provisioned on a dedicated EC2 instance</li>
            <li>Ensure your GitHub token has appropriate repository access</li>
            <li>You'll be charged for EC2 instance usage and API calls</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
