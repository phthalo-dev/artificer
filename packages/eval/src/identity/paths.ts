import path from 'node:path';

export function resolveEvalsDir(identityDir: string): string {
  return path.join(identityDir, 'agent', 'evals');
}
