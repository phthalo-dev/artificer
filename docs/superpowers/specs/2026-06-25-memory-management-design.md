# Memory Management — Design Spec

**Date:** 2026-06-25

## Problem

Memories are currently stored in the ephemeral execution store (`Store`, under
`.artificer/memories/`) rather than in the persistent identity store
(`IdentityStore`, under `identity/memories/`). The API reads from the wrong
store, so memories do not survive between deployments/restarts of the data
directory. Additionally, the UI has no way to add or delete memories manually.

## Goals

1. Read and write memories from `IdentityStore` (persistent) instead of `Store` (ephemeral).
2. Expose `POST /api/memories` to manually create a memory with all fields.
3. Expose `DELETE /api/memories/:id` to delete a memory.
4. Add an "Add Memory" form and a "Delete" button to the UI's Memories page.

## Architecture

### Approach

Pass `IdentityStore` into `createApp` via the existing `AppDeps` object (Option A).
The HTTP layer holds an explicit reference to identity; the ephemeral `Store`
is not involved in memory operations.

---

## Backend Changes (`packages/runtime`)

### `server/app.ts`

**`AppDeps` interface** — add one optional field:

```ts
identity?: IdentityStore   // persistent identity store; required for /memories routes
```

If `identity` is absent (e.g. in tests that call `createApp` without it), the
three memories routes return `503 { error: 'identity store not configured' }`.

**Routes:**

| Method | Path | Implementation |
|--------|------|----------------|
| `GET` | `/api/memories` | `identity.listMemories()` sorted newest-first, or `identity.queryMemories(q)` when `?q=` is present |
| `POST` | `/api/memories` | Validate body, call `identity.addMemory(...)`, return created memory with `201` |
| `DELETE` | `/api/memories/:id` | Call `identity.deleteMemory(id)`; return `404` if not found, `200 { ok: true }` on success |

**`POST /api/memories` zod schema:**

```ts
z.object({
  content: z.string().min(1),
  title:   z.string().optional(),
  summary: z.string().optional(),
  tags:    z.array(z.string()).optional(),
  source:  z.string().optional(),
  kind:    z.enum(['note', 'document', 'preference']).optional(),
})
```

### `api/create-runtime.ts`

Pass `identity` into `createApp`:

```ts
const app = createApp(engine, { identity });
```

---

## Frontend Changes (`apps/runtime-ui`)

### `api/client.ts`

Add `delete` to the `api` object:

```ts
delete: <T>(path: string) => request<T>(path, { method: 'DELETE' })
```

### `api/hooks.ts`

Add two mutations:

**`useCreateMemory()`** — posts to `/memories`, invalidates `['memories']` on success.

Input shape:
```ts
{ content: string; title?: string; summary?: string; tags?: string[];
  source?: string; kind?: 'note' | 'document' | 'preference' }
```

**`useDeleteMemory()`** — deletes `/memories/:id`, invalidates `['memories']` on success.

### `pages/MemoriesPage.tsx`

**Add Memory button** in the page header row alongside the title. Opens a modal
containing a form with these fields:

| Field | Input | Required |
|-------|-------|----------|
| Title | Text input | No |
| Content | Textarea | Yes |
| Summary | Text input | No |
| Tags | Text input (comma-separated, split on submit) | No |
| Kind | Select: note / document / preference | No (defaults to note) |
| Source | Text input (URL or free text) | No |

Submit calls `useCreateMemory`. The submit button shows a loading state while
the mutation is pending. On success the modal closes and the list refreshes.

**Delete button** in the `MemoryDetail` modal — rendered at the bottom of the
modal, styled as a destructive/red action. Calls `useDeleteMemory(memory.id)`.
On success the modal closes and the list refreshes. No separate confirmation
dialog — opening the detail modal and pressing Delete is a deliberate two-step
action.

---

## Data Flow

```
UI → POST /api/memories
       └─ identity.addMemory()
            └─ writes {rootDir}/identity/memories/{id}.md
                       + rebuilds identity/index.json

UI → DELETE /api/memories/:id
       └─ identity.deleteMemory(id)
            └─ unlinks {rootDir}/identity/memories/{id}.md
                       + rebuilds identity/index.json

UI → GET /api/memories[?q=…]
       └─ identity.listMemories() | identity.queryMemories(q)
            └─ reads {rootDir}/identity/memories/*.md
```

---

## Out of Scope

- Editing existing memories (update/patch endpoint).
- Migrating memories from the ephemeral store to identity on upgrade.
- Confirmation dialog for delete (the two-step open → delete is sufficient).
