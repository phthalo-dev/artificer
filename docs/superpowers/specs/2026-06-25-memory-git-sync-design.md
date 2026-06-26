# Memory Git Sync — Design Spec

**Date:** 2026-06-25

## Goal

Optionally commit and push identity memories to git/GitHub after every write
(add, update, delete) so memories persist across deployments and restarts.

---

## Configuration

The existing `IdentityConfig` in `ArtificerConfig` already has `autoCommit`,
`autoPush`, and `commitPrefix` stubs. This spec fills them in and adds `remote`
and `branch`:

```ts
// api/types.ts — already exists, extend with remote/branch
export interface IdentityConfig {
  autoCommit?: boolean;   // commit after every write (default: false)
  autoPush?: boolean;     // push after every commit (default: false)
  commitPrefix?: string;  // commit message prefix (default: "memory:")
  remote?: string;        // git remote name (default: "origin")
  branch?: string;        // branch to push to (default: current branch)
}
```

Set in `artificer.config.ts` (checked in, no secrets):
```ts
export default defineConfig({
  name: 'my-agent',
  identity: {
    autoCommit: true,
    autoPush: true,
  },
});
```

GitHub token auth comes from the existing `GITHUB_TOKEN` env var (already in
`config.github`) — no new env vars needed.

`RuntimeConfig` gains `identity?: IdentityConfig`. `mergeWithDefinition`
threads `definition.identity` through to `RuntimeConfig`.

---

## `IdentityGitSync`

**File:** `packages/runtime/src/storage/identity-git-sync.ts`

Extends `IdentityStore`. Adds one constructor parameter: `syncConfig` (the
resolved `IdentityConfig`) plus `github` (`GitHubConfig | undefined` from
`RuntimeConfig`).

Overrides `addMemory`, `updateMemory`, and `deleteMemory`: calls `super`, then
calls `commitAndPush(message)` as fire-and-forget.

### `commitAndPush(message)`

Runs sequentially in the identity root directory using `buildGitEnv(github)`:

1. `git add identity/` — stages only the memories subtree
2. `git commit -m "{prefix} {message}"` — skipped silently if nothing to commit
3. `git push {remote} {branch}` — only if `autoPush` is true; remote/branch args
   omitted if not configured (uses git defaults)

All steps use `execFile` with the token-injected env. Any error is caught,
logged with `console.error`, and swallowed — git failures never interrupt
memory writes.

### Commit messages

| Operation | Message |
|-----------|---------|
| `addMemory` | `{prefix} add {id}` |
| `updateMemory` | `{prefix} update {id}` |
| `deleteMemory` | `{prefix} delete {id}` |

Default prefix: `"memory:"`.

---

## `createRuntime` Changes

```ts
const identityBase = new IdentityStore(rootDir);
await identityBase.init();

const identity = config.identity?.autoCommit
  ? new IdentityGitSync(rootDir, config.identity, config.github)
  : identityBase;

const memoryService = new WorkstreamMemoryService(identity, store);
const engine = new Engine(config, store, memoryService);
const app = createApp(engine, { identity });
```

`IdentityGitSync` extends `IdentityStore` so it satisfies all existing call
sites (`AppDeps.identity`, `WorkstreamMemoryService`, `ArtificerRuntime.identity`)
without any type changes.

---

## Data Flow

```
Memory write (add / update / delete)
  └─ IdentityGitSync.addMemory / updateMemory / deleteMemory
       ├─ super.addMemory(...)         → writes identity/memories/{id}.md
       └─ commitAndPush("add {id}")
            ├─ git add identity/
            ├─ git commit -m "memory: add {id}"
            └─ git push origin          (if autoPush: true)
```

---

## Out of Scope

- Pull/fetch before push (conflict resolution).
- Configuring the remote URL from config (remote must already be set up in the
  identity repo's git config).
- Signing commits.
