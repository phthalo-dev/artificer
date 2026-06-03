import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { FileCache } from '../engine/file-cache.js';
import { diagnoseEdited } from './diagnose.js';

/** Resolve a user-supplied path inside the workspace, rejecting escapes. */
export function resolveScoped(workspaceDir: string, relative: string): string {
  const resolved = path.resolve(workspaceDir, relative);
  const root = path.resolve(workspaceDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(
      `Path "${relative}" escapes the workspace and is not allowed.`,
    );
  }
  return resolved;
}

export function createFileTools(ctx: ToolContext): ToolDef[] {
  const { workspaceDir } = ctx;

  return [
    {
      name: 'read_file',
      description:
        'Read the contents of a file within the workspace. Paths are relative to the workspace root.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
        },
        required: ['path'],
      },
      handler: async (input) => {
        const rel = String(input.path);
        const target = resolveScoped(workspaceDir, rel);
        const content = await fs.readFile(target, 'utf8');
        if (ctx.run.workstreamId) {
          const stat = await fs.stat(target);
          const lineCount = content.split('\n').length;
          const cache = await FileCache.load(
            ctx.engine.store.layout,
            ctx.run.workstreamId,
            ctx.engine.config.contextBorrowing.fileCacheMaxEntries,
          );
          cache.recordRead(rel, stat.mtimeMs, content, {
            start: 1,
            end: lineCount,
          });
          await cache.save();
        }
        return content;
      },
    },
    {
      name: 'write_file',
      description:
        'Create or overwrite a file within the workspace. Creates parent directories as needed. This is the unit of work a worker operates on.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          content: { type: 'string', description: 'Full file contents.' },
        },
        required: ['path', 'content'],
      },
      handler: async (input) => {
        const rel = String(input.path);
        const target = resolveScoped(workspaceDir, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, String(input.content ?? ''), 'utf8');
        return `Wrote ${rel}${await diagnoseEdited(ctx, [rel])}`;
      },
    },
    {
      name: 'list_files',
      description:
        'List files and directories within a workspace directory (relative to the workspace root).',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative directory path. Defaults to root.',
          },
        },
      },
      handler: async (input) => {
        const rel = input.path ? String(input.path) : '.';
        const target = resolveScoped(workspaceDir, rel);
        const entries = await fs.readdir(target, { withFileTypes: true });
        if (entries.length === 0) return '(empty)';
        return entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .join('\n');
      },
    },
  ];
}
