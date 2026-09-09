import fs from 'node:fs';
import path from 'node:path';

export interface ServiceScriptConfig {
  setup?: string;
  run: string;
  teardown?: string;
  portRange: [number, number];
}

export interface WorkspaceServicesFile {
  services: Record<string, ServiceScriptConfig>;
}

/** The `workspaceServices` block inside artificer.config.json. */
export interface WorkspaceServicesOverrideConfig {
  disabled?: string[];
  overrides?: Record<string, Partial<Pick<ServiceScriptConfig, 'portRange'>>>;
}

/**
 * Reads `.artificer/workspace.json` from a repo root. Returns undefined if
 * the file doesn't exist or fails to parse — same fail-open pattern as
 * loadConfigDefinition in config.ts.
 */
export function loadWorkspaceServiceConfig(
  repoRoot: string,
): WorkspaceServicesFile | undefined {
  const file = path.join(repoRoot, '.artificer', 'workspace.json');
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      services?: unknown;
    };
    if (!parsed || typeof parsed !== 'object' || !parsed.services) {
      return undefined;
    }
    return parsed as WorkspaceServicesFile;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the effective config for one named service: applies the
 * identity-repo override (disable, or field overrides) on top of the
 * target-repo declaration. Returns undefined if the name is unknown or
 * disabled.
 */
export function resolveServiceConfig(
  file: WorkspaceServicesFile | undefined,
  name: string,
  override?: WorkspaceServicesOverrideConfig,
): ServiceScriptConfig | undefined {
  const base = file?.services?.[name];
  if (!base) return undefined;
  if (override?.disabled?.includes(name)) return undefined;
  const fieldOverride = override?.overrides?.[name];
  if (!fieldOverride) return base;
  return { ...base, ...fieldOverride };
}
