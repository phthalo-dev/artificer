import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Distilled superpowers skills shipped with the runtime package. */
export const BUNDLED_SKILLS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../skills',
);
