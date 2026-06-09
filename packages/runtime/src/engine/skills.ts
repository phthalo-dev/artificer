import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Skills composition: load SKILL.md content from a directory and append it
 * to an agent's system prompt. Skills are optional — a missing name or
 * missing dir is silently skipped so the agent still runs.
 *
 * Two on-disk layouts are accepted per skill name:
 *   <dir>/<name>.md
 *   <dir>/<name>/SKILL.md
 * The first match wins; the others are ignored.
 */
export interface SkillsConfig {
  /** Whether to load optional external skills from `dir`. */
  enabled: boolean;
  /** Root directory for optional external skill files. */
  dir: string;
  /**
   * Optional cap (chars) on the total loaded content appended to the system
   * prompt. Skills past the cap are dropped (with a returned truncation flag)
   * so a runaway skills dir cannot blow the model's context window.
   */
  maxTotalChars?: number;
  /**
   * Extra directories searched after the primary `dir`. Used to load bundled
   * superpowers skills that ship with the runtime package.
   */
  additionalDirs?: string[];
}

export interface LoadSkillsResult {
  /** Concatenated skill content, in the order the names were requested. */
  content: string;
  /** Names that were requested and found on disk. */
  loaded: string[];
  /** Names that were requested but no file was found. */
  missing: string[];
  /** True if the content was cut off at maxTotalChars. */
  truncated: boolean;
}

const DEFAULT_SKILL_FILE = 'SKILL.md';

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Look for `<dir>/<name>.md` then `<dir>/<name>/SKILL.md`. */
async function readOneSkillFromDir(
  dir: string,
  name: string,
): Promise<string | null> {
  const flat = await readIfExists(path.join(dir, `${name}.md`));
  if (flat !== null) return flat;
  return readIfExists(path.join(dir, name, DEFAULT_SKILL_FILE));
}

async function readOneSkill(
  name: string,
  dirs: string[],
): Promise<string | null> {
  for (const dir of dirs) {
    const body = await readOneSkillFromDir(dir, name);
    if (body !== null) return body;
  }
  return null;
}

function skillSearchDirs(config: SkillsConfig): string[] {
  const dirs: string[] = [];
  if (config.dir) dirs.push(config.dir);
  if (config.additionalDirs) {
    for (const dir of config.additionalDirs) {
      if (dir && !dirs.includes(dir)) dirs.push(dir);
    }
  }
  return dirs;
}

/** Merge skill name lists, preserving order and dropping duplicates. */
export function mergeSkillNames(
  defaults: string[],
  extra: string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const name of [...defaults, ...extra]) {
    if (seen.has(name)) continue;
    seen.add(name);
    merged.push(name);
  }
  return merged;
}

export async function loadSkills(
  names: string[],
  config: SkillsConfig,
): Promise<LoadSkillsResult> {
  const dirs = skillSearchDirs(config);
  if (names.length === 0 || dirs.length === 0) {
    return { content: '', loaded: [], missing: [...names], truncated: false };
  }

  const loaded: string[] = [];
  const missing: string[] = [];
  const blocks: string[] = [];

  for (const name of names) {
    const body = await readOneSkill(name, dirs);
    if (body === null) {
      missing.push(name);
      continue;
    }
    loaded.push(name);
    blocks.push(`## Skill: ${name}\n\n${body.trim()}`);
  }

  if (blocks.length === 0) {
    return { content: '', loaded, missing, truncated: false };
  }

  let content = blocks.join('\n\n');
  let truncated = false;
  if (config.maxTotalChars && content.length > config.maxTotalChars) {
    content = `${content.slice(0, config.maxTotalChars)}\n\n[…truncated]`;
    truncated = true;
  }
  return { content, loaded, missing, truncated };
}

/**
 * Compose a base system prompt with optional extension and skill content.
 * Pure: same inputs always yield the same string.
 */
export function composeSystemPrompt(
  base: string,
  extension: string | undefined,
  skills: LoadSkillsResult,
): string {
  let out = base;
  if (skills.content) {
    out += `\n\n# Composed skills\n\n${skills.content}`;
  }
  if (extension) {
    out += `\n\n${extension}`;
  }
  return out;
}
