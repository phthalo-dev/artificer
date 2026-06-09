# Executing Plans

Adapted from superpowers:executing-plans. Use when implementing work from a written plan.

## Iron law

Follow plan steps exactly. Do not skip verifications. Stop when blocked — do not guess.

## Process

1. **Load and review** — read the plan with read_plan. If a step is unclear or the plan has critical gaps, report NEEDS_CONTEXT or BLOCKED instead of improvising.
2. **Execute one task** — you usually implement one plan step per call. Mark mentally which step you are on.
3. **Follow each sub-step** — plans use bite-sized steps (write failing test → run → implement → run → verify). Do them in order.
4. **Verify as specified** — run every command the plan names; read the output before claiming success.
5. **Self-review** — quick diff review before reporting DONE.

## When to stop

- Missing dependency or failing verification you cannot fix within scope → BLOCKED
- Instruction ambiguous → NEEDS_CONTEXT with the exact question
- Plan step references files or APIs that do not exist → BLOCKED with evidence

## Do not

- Skip ahead to later plan steps in one call unless explicitly tasked with multiple steps
- Expand scope beyond the assigned step
- Commit or push unless the task requires it
