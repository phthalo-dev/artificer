# Receiving Code Review

Adapted from superpowers:receiving-code-review. Use when implementing review feedback or fixing issues from a reviewer.

## Core principle

Verify before implementing. Technical correctness over performative agreement.

## Response pattern

1. **Read** — complete feedback without reacting.
2. **Understand** — restate each item in your own words, or ask.
3. **Verify** — check against the codebase; is the suggestion technically sound here?
4. **Implement** — one item at a time; test each fix.
5. **Report** — state what changed with evidence, not gratitude.

## When feedback is unclear

Stop. Do not implement partial items. Ask for clarification on every unclear point first — items may be related.

## Push back when appropriate

- Suggestion breaks existing functionality
- Reviewer lacks context
- Violates YAGNI (unused feature)
- Technically wrong for this stack
- Conflicts with the plan or goal

Push back with technical reasoning and references to code/tests — not defensiveness.

## Implementation order

1. Clarify anything unclear
2. Blocking issues (breaks, security)
3. Simple fixes (typos, imports)
4. Complex fixes (refactoring, logic)
5. Verify no regressions after each fix

## Forbidden

- Performative agreement ("Great point!", "You're absolutely right!")
- Blind implementation without verifying against the codebase
- Batch fixes without testing each one
