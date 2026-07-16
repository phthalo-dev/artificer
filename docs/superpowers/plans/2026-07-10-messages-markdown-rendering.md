# Markdown Rendering in Messages UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render chat bubble content in `MessagesPage` as markdown instead of plain text, reusing the existing `MarkdownContent` component.

**Architecture:** Single-file swap in `packages/ui/src/pages/MessagesPage.tsx` — replace the plain `Text` element used for message body with the existing `MarkdownContent` component (`packages/ui/src/components/MarkdownContent.tsx`), which already wraps `react-markdown` + `remark-gfm` with DS-styled links/code. No new dependencies, no changes to `MarkdownContent` itself.

**Tech Stack:** React, TypeScript, `react-markdown`, `remark-gfm` (already installed in `packages/ui`).

## Global Constraints

- No new dependencies are to be added.
- Standard CommonMark paragraph rules apply — do not add `remark-breaks` or any soft-break behavior (per spec, this is a deliberate deviation from the old `pre-wrap` behavior).
- Applies to both inbound and outbound bubbles — do not conditionally render markdown based on `message.direction`.
- Keep the `Text` import in `MessagesPage.tsx` — it's still used for the sender label, timestamp, and workstream link.

---

### Task 1: Render message bubbles as markdown

**Files:**
- Modify: `packages/ui/src/pages/MessagesPage.tsx`

**Interfaces:**
- Consumes: `MarkdownContent` component, exported from `packages/ui/src/components/MarkdownContent.tsx` as `export function MarkdownContent({ content }: { content: string })`. Already imported this way in `packages/ui/src/pages/MemoriesPage.tsx:25` and `packages/ui/src/pages/WorkstreamDetailPage.tsx:31`.
- Produces: nothing consumed by later tasks — this is the only task in the plan.

No automated test exists for `MessagesPage.tsx` and the spec calls for manual verification only (see spec's Testing section), so this task is implement-then-manually-verify rather than TDD.

- [ ] **Step 1: Add the `MarkdownContent` import**

In `packages/ui/src/pages/MessagesPage.tsx`, add this import alongside the existing ones (after the `MessageComposer` import on line 6):

```tsx
import { MarkdownContent } from '../components/MarkdownContent';
```

- [ ] **Step 2: Replace the plain-text message body with `MarkdownContent`**

Still in `packages/ui/src/pages/MessagesPage.tsx`, inside the `Bubble` component, replace:

```tsx
        <Text size="sm" preWrap>{message.content}</Text>
```

with:

```tsx
        <MarkdownContent content={message.content} />
```

The full `Bubble` function should now read:

```tsx
function Bubble({ message }: { message: Message }) {
  const inbound = message.direction === 'inbound';
  return (
    <Group justify={inbound ? 'flex-end' : 'flex-start'} align="flex-start">
      <Paper
        p="sm"
        maw="80%"
        bg={inbound ? color.blueLight : color.surface}
      >
        <Group justify="space-between" gap="xs" mb={4}>
          <Text size="xs" c="dimmed" fw={600}>{inbound ? 'You' : 'Agent'}</Text>
          <Text size="xs" c="dimmed">{formatTime(message.createdAt)}</Text>
        </Group>
        <MarkdownContent content={message.content} />
        {message.workstreamId && (
          <Text size="xs" mt={4}>
            <Link to={`/workstreams/${message.workstreamId}`}>View workstream →</Link>
          </Text>
        )}
      </Paper>
    </Group>
  );
}
```

- [ ] **Step 3: Type-check the UI package**

Run: `pnpm --filter @artificer/ui typecheck`

(If there is no `typecheck` script, run `pnpm --filter @artificer/ui exec tsc --noEmit` instead — check `packages/ui/package.json` scripts first.)

Expected: no errors. `Text` remains used elsewhere in the file (sender label, timestamp, workstream link), so no unused-import error should appear.

- [ ] **Step 4: Manually verify in the browser**

Start the UI dev server (check `packages/ui/package.json` for the `dev` script, e.g. `pnpm --filter @artificer/ui dev`), navigate to the Messages page, and confirm:
- A message containing `**bold**` renders bold text, not literal asterisks.
- A message containing a markdown link `[text](https://example.com)` renders as a clickable link opening in a new tab.
- A message containing a fenced code block renders in the DS `Code` block style.
- Both inbound ("You") and outbound ("Agent") bubbles render markdown identically.

If there's no easy way to seed a markdown-containing message through the existing UI, use the mock data layer (`packages/ui/src/mocks/data.ts` / `packages/ui/src/mocks/handlers.ts`) to temporarily add one, verify visually, then revert the mock change (do not commit test-only mock edits).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/MessagesPage.tsx
git commit -m "$(cat <<'EOF'
feat: render chat messages as markdown

Reuses the existing MarkdownContent component so agent and user
messages render formatted (bold, links, lists, code, tables) instead
of as raw text.
EOF
)"
```
