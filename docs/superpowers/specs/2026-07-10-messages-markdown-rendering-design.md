# Markdown Rendering in Messages UI

**Date:** 2026-07-10
**Status:** Approved

## Problem

`MessagesPage` renders chat bubble content as plain text (`Text` with `preWrap`), so
markdown written by the agent (or the user) shows up as raw syntax instead of
formatted output. The codebase already has a reusable `MarkdownContent` component
(`packages/ui/src/components/MarkdownContent.tsx`), used on the Memories and
Workstream Detail pages, built on `react-markdown` + `remark-gfm` with DS-styled
links, code blocks, and prose typography.

## Change

In `packages/ui/src/pages/MessagesPage.tsx`, the `Bubble` component's message body:

```tsx
<Text size="sm" preWrap>{message.content}</Text>
```

is replaced with:

```tsx
<MarkdownContent content={message.content} />
```

This applies to both inbound (`You`) and outbound (`Agent`) bubbles — every message
is rendered as markdown, regardless of direction.

## Behavior

- Full markdown support already provided by `MarkdownContent`: bold/italic, links
  (opened in a new tab via the DS `Anchor`), lists, headings, blockquotes, tables
  (via `remark-gfm`), and code blocks/inline code (via the DS `Code` component).
- Standard CommonMark paragraph rules apply: a blank line starts a new paragraph;
  a single newline is a soft break within a paragraph. No `remark-breaks` plugin is
  added — this is a deliberate deviation from the current `pre-wrap` behavior,
  where every newline was a visible line break.

## Scope

- Single-file change to `MessagesPage.tsx`.
- No changes to `MessageComposer` — the input remains plain text; users type
  markdown source and see it rendered once sent.
- No changes to `MarkdownContent.tsx` or its styles.
- No new dependencies.
- Keep the `Text` import in `MessagesPage.tsx` — it's still used for the sender
  label, timestamp, and workstream link.

## Testing

No existing test file covers `MessagesPage.tsx`. Verification will be manual: run
the UI, view messages containing markdown syntax (bold, a link, a list, a code
block), and confirm they render formatted rather than as raw text. No new
automated test suite is being added as part of this change.
