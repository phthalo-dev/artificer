import fs from 'node:fs/promises';
import path from 'node:path';
import type { PublishArtifactInput } from './workstream-artifacts.js';

const ARTIFACT_FILE = '.artificer-artifacts.jsonl';

type PublishArtifact = (input: PublishArtifactInput) => Promise<unknown>;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPublishArtifactInput(value: unknown): value is PublishArtifactInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    nonEmptyString(input.key) &&
    nonEmptyString(input.name) &&
    nonEmptyString(input.content)
  );
}

export async function ingestPublishedArtifacts(
  workspaceDir: string,
  publish: PublishArtifact,
): Promise<number> {
  const file = path.join(workspaceDir, ARTIFACT_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  let count = 0;
  try {
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        console.error('Skipping invalid published artifact JSON line');
        continue;
      }
      if (!isPublishArtifactInput(parsed)) {
        console.error('Skipping invalid published artifact input');
        continue;
      }
      try {
        await publish(parsed);
        count += 1;
      } catch (error) {
        console.error('Failed to publish artifact line:', error);
      }
    }
    return count;
  } finally {
    await fs.rm(file, { force: true });
  }
}
