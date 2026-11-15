import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function bumpPatch(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function bumpPackage(relPath) {
  const pkgPath = resolve(root, relPath);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const next = bumpPatch(pkg.version);
  console.log(`${pkg.name}: ${pkg.version} → ${next}`);
  pkg.version = next;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return next;
}

function run(cmd, cwd = root) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd });
}

// 1. Bump versions
console.log('Bumping versions...');
bumpPackage('packages/ui/package.json');
bumpPackage('packages/cli/package.json');
const version = bumpPackage('packages/runtime/package.json');

// 2. Build ui first (runtime's prepublishOnly needs ui/dist to exist)
run('pnpm --filter @artificer-ai/ui build');

// 3. Publish runtime then cli (prepublishOnly builds each before publish)
run(
  'pnpm publish --no-git-checks --access public',
  resolve(root, 'packages/runtime'),
);
run(
  'pnpm publish --no-git-checks --access public',
  resolve(root, 'packages/cli'),
);

// 4. Git commit + tag after successful publish
run(
  'git add packages/cli/package.json packages/runtime/package.json packages/ui/package.json',
);
run(`git commit -m "version ${version}"`);
run(`git tag v${version}`);

console.log(`\nDone — published v${version}`);
