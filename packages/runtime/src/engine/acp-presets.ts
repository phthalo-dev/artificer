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
  return {
    ...userEnv,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...base,
      permission: OPENCODE_PERMISSION,
    }),
  };
}

export function resolveAcpLaunch(config: AcpExecutorConfig): AcpLaunch {
  if (config.agent && config.command) {
    throw new Error('acp executor: set either agent or command, not both');
  }
  if (config.agent) {
    const preset = ACP_PRESETS[config.agent];
    if (!preset) throw new Error(`acp executor: unknown agent ${config.agent}`);
    return {
      name: `acp:${preset.id}`,
      command: preset.command,
      args: config.args ?? preset.args,
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
  return {
    name: `acp:${path.basename(config.command)}`,
    command: config.command,
    args: config.args,
    env: config.env ?? {},
    resumes: config.resumes ?? false,
    permissionEnforcement: 'none',
  };
}
