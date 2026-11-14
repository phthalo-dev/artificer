import os from 'node:os';
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
  codex: {
    id: 'codex',
    label: 'Codex',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp@2.6.0'],
    resumes: true,
    permissionEnforcement: 'acp-requests',
    certified: true,
    verifiedVersion: '2.6.0',
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

const KEY_VARS = ['CODEX_API_KEY', 'OPENAI_API_KEY'] as const;

/** Default directory for Artificer-owned ACP agent state. */
export function defaultAcpStateDir(): string {
  return path.join(os.homedir(), '.artificer', 'acp');
}

/** Artificer-owned paths for a Codex launch under `stateDir`. */
export function codexPaths(stateDir: string): {
  home: string;
  npmrc: string;
} {
  return {
    home: path.join(stateDir, 'codex-home'),
    npmrc: path.join(stateDir, 'npmrc'),
  };
}

function codexEnv(
  userEnv: Record<string, string> | undefined,
  stateDir: string,
): Record<string, string> {
  // A blank user key var is dropped so it cannot shadow a valid key in the
  // process env when the two are merged at spawn.
  const env: Record<string, string> = { ...userEnv };
  for (const k of KEY_VARS) {
    if (k in env && env[k].trim() === '') delete env[k];
  }
  const has = (k: string): boolean =>
    (env[k] ?? process.env[k] ?? '').trim() !== '';
  if (!KEY_VARS.some(has)) {
    throw new Error(
      'acp:codex: set CODEX_API_KEY or OPENAI_API_KEY (Codex runs with API-key auth only)',
    );
  }
  // npm reads npm_config_* case-insensitively; drop user variants so the
  // forced lowercase values below are the only ones.
  for (const k of Object.keys(env)) {
    if (/^npm_config_(userconfig|registry)$/i.test(k)) delete env[k];
  }
  const paths = codexPaths(stateDir);
  // Forced after the user env. An Artificer-owned CODEX_HOME keeps the adapter
  // off a human's ~/.codex ChatGPT login; read-only mode avoids its
  // auto-approve default. npm config is pinned so a home or workspace .npmrc
  // cannot redirect the adapter download. The directories and files are
  // created by AcpExecutor, not here, so validation paths stay free of
  // filesystem side effects.
  return {
    ...env,
    NO_BROWSER: '1',
    INITIAL_AGENT_MODE: 'read-only',
    DEFAULT_AUTH_REQUEST: '{"methodId":"api-key"}',
    CODEX_HOME: paths.home,
    npm_config_userconfig: paths.npmrc,
    npm_config_registry: 'https://registry.npmjs.org/',
  };
}

export function resolveAcpLaunch(
  config: AcpExecutorConfig,
  ctx?: { stateDir?: string },
): AcpLaunch {
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
      env:
        preset.id === 'codex'
          ? codexEnv(config.env, ctx?.stateDir ?? defaultAcpStateDir())
          : opencodeEnv(config.env),
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
