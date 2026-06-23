import fs from 'node:fs';
import type { ArtificerSkill } from '../api/types.js';
import type { ModuleRef } from './discover.js';

export function loadSkillsFromDisk(refs: ModuleRef[]): ArtificerSkill[] {
  return refs
    .filter((ref) => ref.path.endsWith('.md'))
    .map((ref) => {
      const content = fs.readFileSync(ref.path, 'utf-8');
      const firstLine = content.split('\n')[0] ?? '';
      const description = firstLine.replace(/^#\s*/, '').trim() || ref.name;
      return { name: ref.name, description, content };
    });
}

export function loadInstructionsFromDisk(
  filePath: string,
): { content: string } | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content };
  } catch {
    return null;
  }
}
