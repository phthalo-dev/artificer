import path from 'node:path';
import type { AcpExecutorConfig, AcpPresetId } from '../api/types.js';

export interface AcpPreset {
  id: AcpPresetId;
  label: string;
  command: string;
  args: string[];
  resumes: boolean;
  permissionEnforcement: 'acp-requests' | 'none';
  certified: boolean;
  verifiedVersion: string;
}

export const ACP_PRESETS: Record<AcpPresetId, AcpPreset> = {
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    resumes: true,
    permissionEnforcement: 'acp-requests',
    certified: true,
    verifiedVersion: '2.0.32',
  },
};

export interface AcpLaunch {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  resumes: boolean;
  permissionEnforcement: 'acp-requests' | 'none';
}

const OPENCODE_PERMISSION = {
  bash: 'ask',
  edit: 'ask',
  webfetch: 'ask',
  external_directory: 'ask',
};

function opencodeEnv(
  userEnv: Record<string, string> | undefined,
): Record<string, string> {
  let base: Record<string, unknown> = {};
  const raw = userEnv?.OPENCODE_CONFIG_CONTENT;
  if (raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      throw new Error(
        'acp:opencode: OPENCODE_CONFIG_CONTENT is not valid JSON',
      );
    }
  }
  // Both keys are set after the user env so it cannot undo them. Project
  // config is disabled because agent-level permissions in a repo's
  // opencode.json or .opencode/agent/*.md apply after top-level ones and
  // would otherwise switch off the ask block (verified live, 2.0.32).
  return {
    ...userEnv,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...base,
      permission: OPENCODE_PERMISSION,
    }),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  };
}

export function resolveAcpLaunch(config: AcpExecutorConfig): AcpLaunch {
  if (config.agent && config.command) {
    throw new Error('acp executor: set either agent or command, not both');
  }
  if (config.agent) {
    const preset = ACP_PRESETS[config.agent];
    if (!preset) throw new Error(`acp executor: unknown agent ${config.agent}`);
    if (config.args !== undefined) {
      throw new Error(
        `acp:${preset.id}: args cannot be overridden for a preset`,
      );
    }
    return {
      name: `acp:${preset.id}`,
      command: preset.command,
      args: preset.args,
      env: opencodeEnv(config.env),
      resumes: config.resumes ?? preset.resumes,
      permissionEnforcement: preset.permissionEnforcement,
    };
  }
  if (!config.command) {
    throw new Error('acp executor: set either agent or command');
  }
  if (!config.args) {
    throw new Error('acp executor: args is required with command');
  }
  const base = path.basename(config.command);
  // A custom command must never be mistaken for a certified preset in run
  // records or quota accounts.
  const isPresetName = Object.prototype.hasOwnProperty.call(ACP_PRESETS, base);
  return {
    name: isPresetName ? `acp:custom:${base}` : `acp:${base}`,
    command: config.command,
    args: config.args,
    env: config.env ?? {},
    resumes: config.resumes ?? false,
    permissionEnforcement: 'none',
  };
}
