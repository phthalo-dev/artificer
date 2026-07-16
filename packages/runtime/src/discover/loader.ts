import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { ArtificerChannel, ArtificerSkill } from '../api/types.js';
import {
  validateScheduleFields,
  type ScheduleDefinition,
} from '../engine/schedules.js';
import type { ModuleRef } from './discover.js';

function isArtificerChannel(value: unknown): value is ArtificerChannel {
  if (!value || typeof value !== 'object') return false;
  const channel = value as ArtificerChannel;
  return (
    typeof channel.name === 'string' &&
    typeof channel.receive === 'function' &&
    typeof channel.format === 'function'
  );
}

export async function loadChannelsFromDisk(
  refs: ModuleRef[],
): Promise<ArtificerChannel[]> {
  const channels: ArtificerChannel[] = [];

  for (const ref of refs) {
    try {
      const mod = await import(pathToFileURL(ref.path).href);
      const channel = mod.default;
      if (!isArtificerChannel(channel)) {
        console.warn(
          `[artificer] channel "${ref.name}": default export must be an ArtificerChannel`,
        );
        continue;
      }
      channels.push(channel);
    } catch (err) {
      console.warn(`[artificer] failed to load channel "${ref.path}":`, err);
    }
  }

  return channels;
}

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

function parseScheduleFrontmatter(raw: string): {
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

export function loadSchedulesFromDisk(refs: ModuleRef[]): ScheduleDefinition[] {
  const schedules: ScheduleDefinition[] = [];

  for (const ref of refs) {
    try {
      const raw = fs.readFileSync(ref.path, 'utf-8');
      const { fm, body } = parseScheduleFrontmatter(raw);
      const result = validateScheduleFields({
        id: ref.name,
        name: fm.name,
        every: fm.every,
        cron: fm.cron,
        timezone: fm.timezone,
        action: fm.action,
        enabled: fm.enabled,
        body,
        sourcePath: ref.path,
      });
      if (!result.ok) {
        console.warn(`[artificer] schedule "${ref.path}": ${result.error}`);
        continue;
      }
      schedules.push(result.value);
    } catch {
      console.warn(`[artificer] failed to load schedule file "${ref.path}"`);
    }
  }

  return schedules;
}
