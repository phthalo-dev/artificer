# Turbo-Centric CI Testing Design

**Date:** 2026-07-17  
**Status:** Approved

## Problem

CI today is a single job that runs `pnpm ci:packages`: runtime type-check + tests, UI build, runtime build + UI bundle, CLI build. That catches many runtime unit failures and publish-path compile breaks, but:

- CLI and UI have no tests and are barely gated beyond build
- Infrastructure is outside the quality path
- Lint/format are not enforced (root has Prettier config; packages have no `lint` scripts)
- The production Docker image is never built in CI
- Turbo is installed and used for `dev` / `build` / `type-check`, but CI bypasses it via a hand-rolled script

## Goals

- Broader merge gates: lint, type-check, test, build across the workspace
- Cover under-tested packages (CLI, UI) with a small set of high-value tests
- Build the root production Dockerfile in CI (no registry push)
- Make Turbo the source of truth for package quality tasks; CI and release call the same entrypoint

## Non-Goals (this pass)

- ESLint or other JS lint rules beyond Prettier
- CDK synth / AWS-backed infra tests
- Node version matrix
- Turbo remote cache tokens
- Running the container or HTTP healthchecks after image build
- Playwright / browser e2e
- Expanding the runtime test suite beyond what already exists

## Approach

Lean into Turbo: each workspace package exposes `lint`, `type-check`, `test` (where applicable), and `build`. Root scripts wrap `turbo run …`. GitHub Actions runs those tasks plus a parallel Docker build job.

## Turbo Task Graph

Expand `turbo.json` `pipeline` (Turbo 1.x):

| Task | Depends on | Cache | Purpose |
|------|------------|-------|---------|
| `lint` | — | yes | Prettier `--check` for that package |
| `type-check` | `^type-check` | yes | `tsc --noEmit` (existing pattern) |
| `test` | `type-check` (same package) | yes | Package test runner |
| `build` | `^build` | yes | Existing; outputs `dist/**`, `ui-dist/**` |
| `dev` / `clean` | unchanged | — | Existing |

Root `package.json` scripts:

- `lint` → `turbo run lint`
- `type-check` → `turbo run type-check` (already)
- `test` → `turbo run test` (new)
- `build` → `turbo run build` (already)
- `ci` → `turbo run lint type-check test build`

`ci:packages` becomes an alias of `ci` (`"ci:packages": "pnpm ci"`) so existing callers keep working; release and CI use `pnpm ci`.

## Per-Package Scripts

| Package | `type-check` | `test` | `lint` | `build` |
|---------|--------------|--------|--------|---------|
| `@artificer-ai/runtime` | existing | existing `node --import tsx --test` | `prettier --check` on package sources | existing |
| `@artificer-ai/cli` | add `tsc --noEmit` | add `node --import tsx --test` | prettier check | existing |
| `@artificer-ai/ui` | existing | Vitest | prettier check | existing |
| `artificer-infrastructure` | add `tsc --noEmit` | omit (no `test` script; Turbo skips missing tasks) | prettier check | existing `tsc` |

Prettier remains a root `devDependency`. Packages invoke it via `pnpm exec prettier --check <globs>` so they share one config (`.prettierrc`).

Infrastructure joins `lint` / `type-check` / `build` so the workspace is fully on Turbo, but no CDK synth or AWS credentials in CI.

## High-Value Tests

### CLI (`node:test`)

- `init` into a temp directory: assert scaffold files/dirs exist (`artificer.config.json`, `agent/instructions.md`, `package.json`, `.env.example`, agent/identity dirs)
- `makeConfigJson(name)`: parseable JSON with expected `name`, `$schema`, and default preset fields
- Non-empty target directory: assert failure without killing the test process (prefer extracting a pure helper or testing a thrown/returned error path over calling `process.exit` directly)

### UI (Vitest)

- Add Vitest wired to the existing Vite/`@vitejs/plugin-react` setup for future component tests
- First tests are pure unit (no jsdom required unless added later):
  - `format.ts`: `formatCost`, `formatDuration`, `formatTokensShort`
  - `cost.ts`: `costForUsage` for a known model tier

### Runtime

No new tests required; existing suite remains the main coverage under `turbo run test`.

## CI Workflow

`.github/workflows/ci.yml` keeps current triggers and concurrency. Two parallel jobs:

### Job `packages`

1. Checkout
2. pnpm 8.15.1 + Node 22 (match package `engines`)
3. `pnpm install --frozen-lockfile`
4. `pnpm run ci` → `turbo run lint type-check test build`

pnpm store cache via `actions/setup-node` as today. Turbo remote cache is optional later; not required this pass.

### Job `docker`

Runs in parallel with `packages` (faster wall clock; catches Dockerfile-only breakage independently).

1. Checkout
2. Build root `Dockerfile` with BuildKit
3. Use `docker/build-push-action` (or equivalent) with **build only — no push**
4. Enable GitHub Actions cache for layers

Do not use `packages/runtime/Dockerfile` (dev-oriented). Production image is the repo-root multi-stage Dockerfile.

### Release workflow

`.github/workflows/release.yml` replaces `pnpm ci:packages` with `pnpm ci` so publish verification matches PR gates.

## Success Criteria

- A PR that breaks CLI `init` scaffolding, UI cost/format helpers, Prettier formatting, TypeScript in any package, or the root Dockerfile fails CI
- `pnpm run ci` locally matches what GitHub runs for the packages job
- CI remains understandable: Turbo owns package tasks; Docker is a separate smoke

## Implementation Notes

- Turbo 1.x uses `pipeline` in `turbo.json` (already in repo); keep that key unless upgrading Turbo separately
- Packages without a `test` script are skipped by `turbo run test` — do not add empty no-op tests for infrastructure
- If Prettier check initially fails on large unformatted trees, either format in the same PR or scope globs to `src/**` intentionally; prefer scoping to package source trees so generated/`dist` is excluded
