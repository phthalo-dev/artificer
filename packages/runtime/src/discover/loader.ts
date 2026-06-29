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

export interface IdentityRole {
  slug: string;
  name: string;
  blurb: string;
  baseRole: string;
  systemTemplate: string;
}

const VALID_BASE_ROLES = new Set([
  'communicator',
  'orchestrator',
  'planner',
  'worker',
  'reviewer',
  'librarian',
]);

function parseRoleFrontmatter(raw: string): {
  fm: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)(?:\n)?---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw.trim() };
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }
  return { fm, body: match[2].trim() };
}

export function loadRolesFromDisk(refs: ModuleRef[]): IdentityRole[] {
  const roles: IdentityRole[] = [];
  for (const ref of refs) {
    try {
      const raw = fs.readFileSync(ref.path, 'utf-8');
      const { fm, body } = parseRoleFrontmatter(raw);
      let baseRole = fm.baseRole ?? 'worker';
      if (!VALID_BASE_ROLES.has(baseRole)) {
        console.warn(
          `[artificer] role "${ref.name}": unknown baseRole "${baseRole}", falling back to "worker"`,
        );
        baseRole = 'worker';
      }
      roles.push({
        slug: ref.name,
        name: fm.name ?? ref.name,
        blurb: fm.blurb ?? '',
        baseRole,
        systemTemplate: body,
      });
    } catch {
      console.warn(`[artificer] failed to load role file "${ref.path}"`);
    }
  }
  return roles;
}
