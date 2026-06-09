# Writing Plans

Adapted from superpowers:writing-plans. Use when producing an implementation plan.

## Iron law

No vague steps. Every step that changes code must show the exact code and the exact command to run (with expected output).

## Process

1. **Map files first** — list each file to create or modify and its single responsibility. Prefer small, focused files.
2. **Bite-sized tasks** — each step is one action (write failing test → run and confirm fail → minimal implementation → run and confirm pass → commit).
3. **TDD structure** — plans for implementation work follow red-green-refactor per unit of behaviour.
4. **Exact paths** — use real file paths everywhere; no "the handler file" or "relevant tests".
5. **No placeholders** — never "TBD", "add error handling", "handle edge cases", or "similar to step N".

## Self-review before finishing

- Spec coverage: every requirement maps to a step.
- Placeholder scan: remove vague steps.
- Consistency: names, types, and signatures match across steps.
- Scope: no steps fixing unrelated pre-existing or environment breakage.
