import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEvalSuite, type EvalSuiteDefinition } from '../types.js';
import { resolveEvalsDir } from './paths.js';

export async function loadEvalSuite(
  identityDir: string,
  suiteId: string,
): Promise<EvalSuiteDefinition> {
  const raw = await fs.readFile(
    path.join(resolveEvalsDir(identityDir), 'suites', `${suiteId}.json`),
    'utf8',
  );
  return parseEvalSuite(JSON.parse(raw));
}

export async function listEvalSuites(identityDir: string): Promise<string[]> {
  const suitesDir = path.join(resolveEvalsDir(identityDir), 'suites');
  let entries: string[];
  try {
    entries = await fs.readdir(suitesDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  return entries
    .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
    .map((name) => path.basename(name, '.json'))
    .sort();
}
