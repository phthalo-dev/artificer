# Eval examples

Maintainer-oriented eval packs and notes for refreshing vendored `repo-patch` fixtures.

These trees live under `evals/examples/` in the Artificer monorepo. They are **not** shipped in the npm packages — copy them into a local identity when dogfooding.

## Pack A smoke tasks

`artificer init` scaffolds Pack A under `agent/evals/`. The `fix-format-cost-display` task vendors a mini repo under `fixture/` (not a clone of Artificer):

- Correct `src/format.js` is committed first.
- Optional `fixture/introduce-bug.patch` is applied by the driver before the agent runs.
- Hidden tests under `hidden/` grade the agent patch.

## Pack B `runtime-dev` (maintainer dogfooding)

`evals/examples/runtime-dev/` is a five-task suite aimed at Artificer maintainers. Repo-patch tasks use the same offline pattern as Pack A (`repo.url: "fixture"` + vendored mini fixtures). They do **not** require cloning this monorepo. You can later replace a fixture with a real Artificer `repo.url` + `baseCommit` pin when dogfooding against mainline code.

| Task id | Kind | Intent |
|---------|------|--------|
| `workstream-status-api` | `repo-patch` | Restore `paused` on a tiny `/api/state` stand-in |
| `quota-window-pause` | `repo-patch` | Inclusive pause-at-limit in quota window logic |
| `bench-report-regression` | `repo-patch` | Fix off-by-one in resolve-rate math |
| `role-override-loaded` | `message` | Worker role override reflected in reply (`eval-dogfood`) |
| `memory-recall-query` | `message` | Recall a pre-seeded memory (`pack-b-token`) |

### Copy into a dev identity

```bash
cp -R evals/examples/runtime-dev/* path/to/identity/agent/evals/
```

Then from that identity:

```bash
artificer eval list
artificer eval run --suite smoke
# or a single task:
artificer eval run --task quota-window-pause
```

For the two `message` tasks, seed the identity first:

- `role-override-loaded` — put the phrase `eval-dogfood` in `agent/roles/worker.md`
- `memory-recall-query` — add a memory under the identity that contains `pack-b-token`

## Refreshing `introduce-bug.patch`

1. Materialize (or copy) the clean fixture tree (exclude `introduce-bug.patch`).
2. Edit files to the intentional failing state.
3. From the clean tree root:

```bash
git init -q
git add -A && git commit -q -m fixture
# edit files to the buggy state, then:
git diff > fixture/introduce-bug.patch
```

4. Re-run unit tests that apply the patch and grade a known fix to confirm the hunk still applies.

For remote pins (`repo.url` is a git URL), keep `repo.baseCommit` fixed and refresh `introduce-bug.patch` the same way against that commit.

## GitHub Action recipe

Copy [`github-eval.yml`](./github-eval.yml) to `.github/workflows/eval.yml` in an identity repo to run `artificer eval run --suite smoke` on PRs that touch `agent/`.

## Downloadable SWE-bench pack

`artificer eval run --pack swebench-lite-30` uses the curated 30-instance Lite subset (also at `packages/runtime/bench/tasks/swebench-lite-curated-30.json` for `pnpm bench`).
