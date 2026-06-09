# Shape (UX Design Planning)

Adapted from shape. Use when planning UI/UX before implementation.

## Iron law

Understand users and goals before specifying layout or components. No code in this phase — produce thinking that makes implementation precise.

## Discovery (from repo + goal)

Before writing the plan, establish:
- **Who** uses this and in what context (rushed, exploring, anxious)?
- **What** is the primary user action — the one thing that must be obvious?
- **Content ranges** — empty, typical, and maximum data (0 items vs 500)
- **States** — default, empty, loading, error, success, first-time, power-user
- **Constraints** — framework, a11y level, responsive targets, performance budget
- **Anti-goals** — what this must NOT become

## Design brief (include in write_plan)

Structure the plan with a **Design Brief** section before implementation steps:

1. **Feature summary** — 2–3 sentences: what, who, why
2. **Primary user action** — single most important outcome
3. **Design direction** — how it should feel; tie to `.impeccable.md` if present
4. **Layout strategy** — visual hierarchy and rhythm, not CSS details
5. **Key states** — each state: what the user sees and feels
6. **Interaction model** — entry → completion flow, feedback on actions
7. **Implementation steps** — bite-sized, TDD where applicable, exact file paths

## For autonomous runs

You cannot interview the user. Infer from the goal and codebase; document assumptions in the brief. Flag unresolved design decisions as risks for the orchestrator.
