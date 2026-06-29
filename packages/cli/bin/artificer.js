#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.resolve(__dirname, '../dist/index.js');

if (existsSync(distEntry)) {
  await import(distEntry);
} else {
  const require = createRequire(import.meta.url);
  const tsxBin = path.resolve(
    require.resolve('tsx/package.json'),
    '../dist/cli.mjs',
  );
  const entry = path.resolve(__dirname, '../src/index.ts');
  try {
    execFileSync(process.execPath, [tsxBin, entry, ...process.argv.slice(2)], {
      stdio: 'inherit',
    });
  } catch (e) {
    process.exit(e.status ?? 1);
  }
}
