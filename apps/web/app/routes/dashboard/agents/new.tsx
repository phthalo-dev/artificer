import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { trpc } from '~/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { TextField } from 'react-aria-components';

export const Route = createFileRoute('/dashboard/agents/new')({
  component: NewAgentPage,
});

const PROVISION_STEPS = [
  { label: 'Saving agent configuration', duration: 1500 },
  { label: 'Resolving latest Ubuntu AMI', duration: 3000 },
  { label: 'Launching EC2 instance', duration: 8000 },
  { label: 'Waiting for instance to initialize', duration: 90000 },
  { label: 'Installing OpenCode and dependencies', duration: 60000 },
  { label: 'Starting agent services', duration: 30000 },
];

function ProvisioningProgress() {
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [stepElapsed, setStepElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((e) => e + 1);
      setStepElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (currentStep >= PROVISION_STEPS.length - 1) return;
    setStepElapsed(0);
    const timer = setTimeout(() => {
      setCurrentStep((s) => s + 1);
    }, PROVISION_STEPS[currentStep].duration);
    return () => clearTimeout(timer);
  }, [currentStep]);

  const stepDurationSec = Math.floor(PROVISION_STEPS[currentStep].duration / 1000);

  return (
    <div className="space-y-6 py-2">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <svg className="h-4 w-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <span>Elapsed: {elapsed}s — this takes 2–4 minutes</span>
      </div>

      <ol className="space-y-3">
        {PROVISION_STEPS.map((step, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <li key={i} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {done ? (
                  <svg className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : active ? (
                  <svg className="h-4 w-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <div className="h-2 w-2 rounded-full bg-gray-300" />
                )}
              </div>
              <div className="flex-1">
                <p className={active ? 'font-medium text-foreground' : done ? 'text-muted-foreground line-through' : 'text-muted-foreground'}>
                  {step.label}
                </p>
                {active && stepDurationSec > 5 && (
                  <p className="text-xs text-muted-foreground">
                    ~{Math.max(0, stepDurationSec - stepElapsed)}s remaining
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

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
          <CardTitle>{createMutation.isPending ? 'Provisioning Agent' : 'Agent Configuration'}</CardTitle>
          <CardDescription>
            {createMutation.isPending
              ? `Setting up "${name}" on a dedicated EC2 instance`
              : 'Configure your agent\'s identity and credentials'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {createMutation.isPending ? (
            <ProvisioningProgress />
          ) : (
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
                >
                  Cancel
                </Button>
                <Button type="submit">
                  Create Agent
                </Button>
              </div>
            </form>
          )}
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
