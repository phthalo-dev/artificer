import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the bundled UI assets directory relative to the runtime package root. */
export function resolveUiDistDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(here, '../..');
  return path.join(packageRoot, 'ui-dist');
}

export function uiDistExists(distDir: string): boolean {
  try {
    return fs.statSync(path.join(distDir, 'index.html')).isFile();
  } catch {
    return false;
  }
}
