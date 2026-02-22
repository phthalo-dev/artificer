import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';

interface OpenCodeAgentConfig {
  model?: string;
  temperature?: number;
  topP?: number;
  maxSteps?: number;
  systemPrompt?: string;
  permissions?: {
    bash?: 'allow' | 'ask' | 'deny';
    edit?: 'allow' | 'ask' | 'deny';
    write?: 'allow' | 'ask' | 'deny';
    webfetch?: 'allow' | 'ask' | 'deny';
  };
}

const AVAILABLE_MODELS = [
  {
    id: 'anthropic/claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-haiku-3-20250514',
    name: 'Claude Haiku 3',
    provider: 'Anthropic',
  },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
] as const;

interface AgentConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: OpenCodeAgentConfig) => Promise<void>;
  currentConfig: OpenCodeAgentConfig;
  isRunning: boolean;
}

export function AgentConfigModal({
  isOpen,
  onClose,
  onSave,
  currentConfig,
  isRunning,
}: AgentConfigModalProps) {
  const [model, setModel] = useState(currentConfig?.model || '');
  const [temperature, setTemperature] = useState(
    currentConfig?.temperature ?? 0.3,
  );
  const [maxSteps, setMaxSteps] = useState(currentConfig?.maxSteps ?? 50);
  const [systemPrompt, setSystemPrompt] = useState(
    currentConfig?.systemPrompt || '',
  );
  const [permBash, setPermBash] = useState<'allow' | 'ask' | 'deny'>(
    currentConfig?.permissions?.bash || 'allow',
  );
  const [permEdit, setPermEdit] = useState<'allow' | 'ask' | 'deny'>(
    currentConfig?.permissions?.edit || 'allow',
  );
  const [permWrite, setPermWrite] = useState<'allow' | 'ask' | 'deny'>(
    currentConfig?.permissions?.write || 'allow',
  );
  const [permWebfetch, setPermWebfetch] = useState<'allow' | 'ask' | 'deny'>(
    currentConfig?.permissions?.webfetch || 'allow',
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setModel(currentConfig?.model || '');
      setTemperature(currentConfig?.temperature ?? 0.3);
      setMaxSteps(currentConfig?.maxSteps ?? 50);
      setSystemPrompt(currentConfig?.systemPrompt || '');
      setPermBash(currentConfig?.permissions?.bash || 'allow');
      setPermEdit(currentConfig?.permissions?.edit || 'allow');
      setPermWrite(currentConfig?.permissions?.write || 'allow');
      setPermWebfetch(currentConfig?.permissions?.webfetch || 'allow');
    }
  }, [isOpen, currentConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        model: model || undefined,
        temperature: temperature || undefined,
        maxSteps: maxSteps || undefined,
        systemPrompt: systemPrompt || undefined,
        permissions: {
          bash: permBash,
          edit: permEdit,
          write: permWrite,
          webfetch: permWebfetch,
        },
      });
      onClose();
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Agent</DialogTitle>
          <DialogDescription>
            Customize how this agent behaves and what it can do
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!isRunning && (
            <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
              Agent is not running. Configuration changes will be applied on
              next start.
            </div>
          )}

          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Model Settings</h3>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <select
                  id="model"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">Select a model...</option>
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxSteps">Max Steps</Label>
                <Input
                  id="maxSteps"
                  type="number"
                  min={1}
                  max={100}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(parseInt(e.target.value) || 50)}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum agentic iterations before responding
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="temperature">
                Temperature: {temperature.toFixed(1)}
              </Label>
              <input
                id="temperature"
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Focused (0.0)</span>
                <span>Creative (1.0)</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-lg">System Prompt</h3>
            <div className="space-y-2">
              <Label htmlFor="systemPrompt">Custom Instructions</Label>
              <textarea
                id="systemPrompt"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Additional instructions for the agent..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                These instructions will be added to the agent's system prompt
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Permissions</h3>
            <p className="text-sm text-muted-foreground">
              Control what tools the agent can use without asking
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <PermissionSelect
                label="Shell Commands (bash)"
                value={permBash}
                onChange={setPermBash}
                description="Run terminal commands"
              />
              <PermissionSelect
                label="Edit Files"
                value={permEdit}
                onChange={setPermEdit}
                description="Modify existing files"
              />
              <PermissionSelect
                label="Write Files"
                value={permWrite}
                onChange={setPermWrite}
                description="Create new files"
              />
              <PermissionSelect
                label="Web Fetch"
                value={permWebfetch}
                onChange={setPermWebfetch}
                description="Access URLs"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onPress={onClose}>
            Cancel
          </Button>
          <Button onPress={handleSave} isDisabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PermissionSelectProps {
  label: string;
  value: 'allow' | 'ask' | 'deny';
  onChange: (value: 'allow' | 'ask' | 'deny') => void;
  description: string;
}

function PermissionSelect({
  label,
  value,
  onChange,
  description,
}: PermissionSelectProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(e) => onChange(e.target.value as 'allow' | 'ask' | 'deny')}
      >
        <option value="allow">Allow</option>
        <option value="ask">Ask First</option>
        <option value="deny">Deny</option>
      </select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
