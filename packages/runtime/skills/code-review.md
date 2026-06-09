# Code Review

Adapted from superpowers:requesting-code-review. Use when reviewing plans or implemented work.

## Iron law

Read the actual diff and verify claims yourself. Never approve from summaries alone.

## What to check

**Plan alignment (plans and work):**
- Does it match the goal or plan requirements?
- Missing functionality? Unrequested extras?
- Deviations — intentional improvement or problematic drift?

**Code quality (work only):**
- Correctness, clarity, error handling, edge cases
- Fit with existing codebase patterns
- Tests verify real behaviour (not mocks testing mocks)
- DRY without premature abstraction

**Production readiness (when relevant):**
- Security concerns, backward compatibility, migration needs

## Severity calibration

Not everything is Critical. Acknowledge what was done well before listing issues.

| Severity | Examples |
|----------|----------|
| Critical | Broken, unsafe, fails spec — must fix |
| Important | Architecture gaps, missing features, test holes — should fix |
| Minor | Style, polish, nice-to-haves — non-blocking |

## Output requirements

Every issue needs: file:line (or file path for plans), what is wrong, why it matters, what a worker should change.

Give a clear verdict via submit_review — approved only when no Critical or Important issues remain.

## Do not

- Say "looks good" without reading the diff
- Mark nits as Critical
- Fix issues yourself — describe fixes for workers
- Give vague feedback ("improve error handling")
