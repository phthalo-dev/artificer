# Turbo-Centric CI Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Turbo the source of truth for lint/type-check/test/build across the workspace, add high-value CLI and UI tests, and gate PRs with `pnpm ci` plus a parallel root Docker image build.

**Architecture:** Each package exposes Turbo tasks (`lint`, `type-check`, `test`, `build`). Root `pnpm ci` runs `turbo run lint type-check test build`. GitHub Actions runs that packages job in parallel with a no-push Docker build of the repo-root Dockerfile. Prettier is the lint check; Vitest covers UI; CLI/runtime keep `node:test`.

**Tech Stack:** Turbo 1.x (`pipeline` key), pnpm 8.15.1, Node 21 in CI, Prettier (root), Vitest + Vite 6 for UI, `node:test` + tsx for CLI/runtime, `docker/build-push-action` (build only).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-turbo-ci-testing-design.md`
- Keep Turbo 1.x `pipeline` key (do not rename to `tasks` unless upgrading Turbo)
- No ESLint, no CDK synth, no container run/healthcheck, no Node matrix
- Prettier globs scoped to package source trees (exclude `dist` / generated)
- `ci:packages` must alias `pnpm ci` for backwards compatibility
- Docker job builds **repo-root** `Dockerfile` only (never `packages/runtime/Dockerfile`)
- Commits: only when the user asks, or at task boundaries if executing-plans/subagent skills require — prefer one commit per completed task when implementing

---

## File Map

**Created:**
- `packages/cli/src/commands/init.test.ts` — CLI init + `makeConfigJson` tests
- `packages/ui/src/format.test.ts` — format helper tests
- `packages/ui/src/cost.test.ts` — cost helper tests
- `packages/ui/vitest.config.ts` — Vitest config wired to Vite React plugin

**Modified:**
- `turbo.json` — add `test` task; keep/adjust `lint` / `type-check` / `build`
- `package.json` — add `test`, `ci`; alias `ci:packages`
- `packages/runtime/package.json` — add `lint`
- `packages/cli/package.json` — add `type-check`, `test`, `lint`
- `packages/ui/package.json` — add `test`, `lint`, vitest dep
- `infrastructure/package.json` — add `type-check`, `lint`
- `packages/cli/src/commands/init.ts` — throw on non-empty dir (testable)
- `packages/cli/src/index.ts` — catch init errors and `process.exit(1)`
- `.github/workflows/ci.yml` — packages via `pnpm ci` + parallel docker job
- `.github/workflows/release.yml` — use `pnpm ci`

---

### Task 1: Turbo pipeline + root `ci` scripts

**Files:**
- Modify: `turbo.json`
- Modify: `package.json`

**Interfaces:**
- Produces: root scripts `test`, `ci`, `ci:packages` → `pnpm ci`; Turbo `test` task with `dependsOn: ["type-check"]`

- [ ] **Step 1: Update `turbo.json`**

Replace the `pipeline` section so it includes `test` and clear lint/type-check behavior:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "ui-dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "type-check": {
      "dependsOn": ["^type-check"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["type-check"],
      "outputs": []
    },
    "clean": {
      "cache": false
    }
  }
}
```

Remove obsolete `.next/**` outputs (this repo does not use Next.js).

- [ ] **Step 2: Update root `package.json` scripts**

Ensure scripts include:

```json
"lint": "turbo run lint",
"type-check": "turbo run type-check",
"test": "turbo run test",
"build": "turbo run build",
"ci": "turbo run lint type-check test build",
"ci:packages": "pnpm ci"
```

Keep existing scripts (`dev`, `clean`, changeset/publish, etc.) unchanged except replace the old long `ci:packages` command with the alias above.

- [ ] **Step 3: Commit**

```bash
git add turbo.json package.json
git commit -m "$(cat <<'EOF'
chore: wire turbo ci entrypoint for lint/type-check/test/build

EOF
)"
```

---

### Task 2: Package `lint` / `type-check` / `test` scripts

**Files:**
- Modify: `packages/runtime/package.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/ui/package.json`
- Modify: `infrastructure/package.json`

**Interfaces:**
- Produces: every package has `lint`; CLI + infra have `type-check`; CLI has `test` script (tests added in Task 3); UI has `test` script (Vitest wired in Task 4). Infra has **no** `test` script.

- [ ] **Step 1: Add scripts to each package**

**`packages/runtime/package.json`** — add:

```json
"lint": "prettier --check \"src/**/*.{ts,json}\" \"artificer.config.schema.json\""
```

Keep existing `type-check` and `test`.

**`packages/cli/package.json`** — add:

```json
"type-check": "tsc --noEmit",
"test": "node --import tsx --test \"src/**/*.test.ts\"",
"lint": "prettier --check \"src/**/*.ts\" \"bin/**/*.js\""
```

**`packages/ui/package.json`** — add (Vitest dep added in Task 4; script can land now):

```json
"test": "vitest run",
"lint": "prettier --check \"src/**/*.{ts,tsx,css}\""
```

**`infrastructure/package.json`** — add:

```json
"type-check": "tsc --noEmit",
"lint": "prettier --check \"bin/**/*.ts\" \"lib/**/*.ts\" \"lambda/**/*.ts\""
```

Do **not** add `test` to infrastructure.

- [ ] **Step 2: Smoke-check scripts that already have implementations**

Run from repo root:

```bash
pnpm --filter @artificer-ai/runtime lint
pnpm --filter @artificer-ai/cli type-check
pnpm --filter artificer-infrastructure type-check
```

Expected: Prettier may fail if files are unformatted — if so, run `pnpm exec prettier --write` on the failing globs for that package and include formatting in this task’s commit. Type-check should pass (or fix only issues introduced by script wiring).

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/package.json packages/cli/package.json packages/ui/package.json infrastructure/package.json
# include any prettier --write fixes if needed
git commit -m "$(cat <<'EOF'
chore: add per-package lint and type-check scripts for turbo

EOF
)"
```

---

### Task 3: CLI init tests + testable non-empty error

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/init.test.ts`

**Interfaces:**
- Consumes: existing `init(name, targetDir?)`, `makeConfigJson(name)`
- Produces: `init` throws `Error` with message `Directory ${dir} already exists and is not empty.` instead of `process.exit(1)`; `index.ts` catches and exits

- [ ] **Step 1: Write failing tests**

Create `packages/cli/src/commands/init.test.ts`:

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { init, makeConfigJson } from './init.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('makeConfigJson returns valid JSON with name and default preset', () => {
  const raw = makeConfigJson('demo-agent');
  const config = JSON.parse(raw);
  assert.equal(config.name, 'demo-agent');
  assert.equal(
    config.$schema,
    './node_modules/@artificer-ai/runtime/artificer.config.schema.json',
  );
  assert.equal(config.preset, 'go-economy');
  assert.equal(config.quota.routes[0].presetId, 'go-economy');
  assert.equal(config.quota.routes[1].presetId, 'async-economy');
});

test('init scaffolds expected files and directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-init-'));
  tempDirs.push(dir);
  init('demo-agent', dir);

  assert.ok(fs.existsSync(path.join(dir, 'artificer.config.json')));
  assert.ok(fs.existsSync(path.join(dir, 'agent', 'instructions.md')));
  assert.ok(fs.existsSync(path.join(dir, 'package.json')));
  assert.ok(fs.existsSync(path.join(dir, '.env.example')));
  assert.ok(fs.existsSync(path.join(dir, 'agent', 'tools')));
  assert.ok(fs.existsSync(path.join(dir, 'agent', 'channels')));
  assert.ok(fs.existsSync(path.join(dir, 'agent', 'skills')));
  assert.ok(fs.existsSync(path.join(dir, 'identity', 'memories')));

  const written = JSON.parse(
    fs.readFileSync(path.join(dir, 'artificer.config.json'), 'utf8'),
  );
  assert.equal(written.name, 'demo-agent');
});

test('init throws when target directory is not empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-init-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'existing.txt'), 'nope');

  assert.throws(
    () => init('demo-agent', dir),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes('already exists and is not empty'),
  );
});
```

- [ ] **Step 2: Run tests — expect non-empty case to fail (exit kills process) or fail assertion**

```bash
cd packages/cli && pnpm test
```

Expected: FAIL or hang/exit on the non-empty test until `init` throws instead of `process.exit`.

- [ ] **Step 3: Make `init` throw; catch in CLI entry**

In `packages/cli/src/commands/init.ts`, replace the non-empty block:

```typescript
if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
  throw new Error(`Directory ${dir} already exists and is not empty.`);
}
```

In `packages/cli/src/index.ts`, wrap init:

```typescript
case 'init': {
  const { init } = await import('./commands/init.js');
  try {
    init(args[0] ?? 'my-agent');
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  break;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd packages/cli && pnpm test && pnpm type-check
```

Expected: all three tests pass; type-check passes.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/src/commands/init.test.ts packages/cli/src/index.ts packages/cli/package.json
git commit -m "$(cat <<'EOF'
test(cli): cover init scaffolding and makeConfigJson

EOF
)"
```

---

### Task 4: UI Vitest + format/cost unit tests

**Files:**
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/format.test.ts`
- Create: `packages/ui/src/cost.test.ts`
- Modify: `packages/ui/package.json`

**Interfaces:**
- Produces: `vitest` as UI test runner; tests for `formatCost` / `formatDuration` / `formatTokensShort` / `costForUsage`

- [ ] **Step 1: Add Vitest dependency and config**

From repo root:

```bash
pnpm --filter @artificer-ai/ui add -D vitest
```

Create `packages/ui/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

Ensure `packages/ui/package.json` has `"test": "vitest run"`.

- [ ] **Step 2: Write failing tests**

`packages/ui/src/format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { formatCost, formatDuration, formatTokensShort } from './format';

describe('formatCost', () => {
  it('formats zero and small amounts', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(1.5)).toBe('$1.50');
  });
});

describe('formatDuration', () => {
  it('uses s/m/h units', () => {
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(834_000)).toBe('13.9m');
    expect(formatDuration(4_320_000)).toBe('1.2h');
  });
});

describe('formatTokensShort', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokensShort(812)).toBe('812');
    expect(formatTokensShort(47_000)).toBe('47k');
    expect(formatTokensShort(1_200_000)).toBe('1.2M');
  });
});
```

`packages/ui/src/cost.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { costForUsage } from './cost';

describe('costForUsage', () => {
  it('prices sonnet-tier usage', () => {
    const cost = costForUsage('claude-sonnet-4', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 1,
    });
    // sonnet inputPerMTok = 3
    expect(cost).toBe(3);
  });

  it('falls back to sonnet pricing for unknown models', () => {
    const cost = costForUsage('unknown-model', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 1,
    });
    expect(cost).toBe(3);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd packages/ui && pnpm test && pnpm type-check
```

Expected: PASS. If formatDuration expectations differ slightly due to rounding, adjust expected strings to match actual `format.ts` behavior (do not change production formatting unless clearly buggy).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/package.json packages/ui/vitest.config.ts packages/ui/src/format.test.ts packages/ui/src/cost.test.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
test(ui): add vitest with format and cost unit tests

EOF
)"
```

---

### Task 5: GitHub Actions — packages + docker

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: root `pnpm ci`
- Produces: parallel `packages` and `docker` jobs on PR/main

- [ ] **Step 1: Replace `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  packages:
    name: Lint, type-check, test, build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 8.15.1

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 21
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: CI
        run: pnpm ci

  docker:
    name: Build production image
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: false
          tags: artificer-runtime:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Update release workflow verify step**

In `.github/workflows/release.yml`, change:

```yaml
      - name: Verify publishable packages build
        run: pnpm ci:packages
```

to:

```yaml
      - name: Verify packages
        run: pnpm ci
```

- [ ] **Step 3: Local verification**

```bash
pnpm ci
```

Expected: Turbo runs lint → type-check → test → build across packages that define each task; exit 0.

Optionally (if Docker available locally):

```bash
docker build -t artificer-runtime:ci -f Dockerfile .
```

Expected: image builds successfully.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
ci: run turbo gates and build production Docker image

EOF
)"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Turbo task graph (`lint`, `type-check`, `test`, `build`) | 1 |
| Root `ci` / `ci:packages` alias | 1 |
| Per-package lint/type-check/test scripts | 2 |
| CLI init + makeConfigJson tests; throw on non-empty | 3 |
| UI Vitest + format/cost tests | 4 |
| CI packages job via `pnpm ci` | 5 |
| Parallel Docker build, no push, root Dockerfile | 5 |
| Release uses same gate | 5 |
| No ESLint / CDK synth / matrix / healthcheck | honored (omitted) |

## Self-Review Notes

- No TBD/placeholder steps
- `init` error message in tests matches implementation string
- Infrastructure intentionally has no `test` script (Turbo skips)
- Vitest `environment: 'node'` matches pure-unit first pass; React plugin remains for future component tests
