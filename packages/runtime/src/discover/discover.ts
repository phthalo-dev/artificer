import fs from 'node:fs';
import path from 'node:path';

export interface ModuleRef {
  name: string;
  path: string;
}

export interface AgentManifest {
  config?: ModuleRef;
  instructions?: ModuleRef;
  tools: ModuleRef[];
  channels: ModuleRef[];
  skills: ModuleRef[];
  memories: ModuleRef[];
  roles: ModuleRef[];
}

function listByExt(dir: string, ext: string): ModuleRef[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(ext) && !f.startsWith('.'))
    .map((f) => ({ name: path.basename(f, ext), path: path.join(dir, f) }));
}

export function scanAgentDirectory(rootDir: string): AgentManifest {
  const manifest: AgentManifest = {
    tools: [],
    channels: [],
    skills: [],
    memories: [],
    roles: [],
  };

  const configPath = path.join(rootDir, 'artificer.config.json');
  if (fs.existsSync(configPath)) {
    manifest.config = { name: 'config', path: configPath };
  }

  const instructionsPath = path.join(rootDir, 'agent', 'instructions.md');
  if (fs.existsSync(instructionsPath)) {
    manifest.instructions = { name: 'instructions', path: instructionsPath };
  }

  manifest.tools = listByExt(path.join(rootDir, 'agent', 'tools'), '.ts');
  manifest.channels = listByExt(path.join(rootDir, 'agent', 'channels'), '.ts');
  manifest.skills = [
    ...listByExt(path.join(rootDir, 'agent', 'skills'), '.md'),
    ...listByExt(path.join(rootDir, 'agent', 'skills'), '.ts'),
  ];
  manifest.roles = listByExt(path.join(rootDir, 'agent', 'roles'), '.md');
  manifest.memories = listByExt(
    path.join(rootDir, 'identity', 'memories'),
    '.md',
  );

  return manifest;
}
