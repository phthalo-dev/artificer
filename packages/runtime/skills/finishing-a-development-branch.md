# Finishing a Development Branch

Adapted from superpowers:finishing-a-development-branch. Use when implementation is complete and the task calls for git integration.

## Iron law

```
VERIFY TESTS BEFORE MERGE, PUSH, OR PR
```

Never open a PR or merge with failing tests.

## When this applies

Only when the task explicitly asks you to commit, push, open a PR, or finish integration work. Single-file implementation tasks usually do not need this.

## Process

1. **Verify** — run the project's test suite (or the plan's verification command). All green before proceeding.
2. **Check git state** — git status, current branch, what changed.
3. **Integrate appropriately:**
   - Task says open PR → commit, push branch, gh_pr_create with summary and test plan
   - Task says commit only → git add, git commit with a clear message
   - No git instructions → report DONE without git operations

## PR body should include

- 2–3 bullets summarizing what changed
- Test plan checklist of what you verified

## Do not

- Force-push unless explicitly requested
- Delete branches or discard work without explicit instruction
- Merge to main/master unless the task explicitly requires it
- Create a PR when tests fail — fix or report BLOCKED first
