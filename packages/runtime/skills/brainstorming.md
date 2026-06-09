# Brainstorming Before Planning

Adapted from superpowers:brainstorming. Use when investigating a task before writing a plan.

## Iron law

Understand requirements and constraints before planning implementation. No code changes in the plan phase except investigation.

## Process

1. **Explore project context** — read relevant files, docs, recent structure, how similar features are built.
2. **Assess scope** — if the goal spans multiple independent subsystems, decompose into ordered sub-goals in the plan rather than one monolithic change.
3. **Identify gaps** — list ambiguities, missing decisions, or assumptions that affect the design. Resolve what you can from the repo; note the rest as explicit plan risks or questions for the orchestrator.
4. **Propose approaches** — when multiple designs are viable, pick one in the plan with brief trade-off rationale.
5. **Then write the plan** — transition to concrete steps only after you understand what to build.

## Anti-patterns

- "Too simple to need investigation" — simple tasks still need file mapping and verification steps
- Planning implementation details before reading the codebase
- One giant step instead of decomposed tasks

## For autonomous runs

You cannot ask the user questions mid-run. When requirements are ambiguous:
- State assumptions explicitly in the plan
- Prefer the smallest change that satisfies the stated goal
- Flag open questions in the plan summary for the orchestrator
