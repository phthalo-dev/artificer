# Design Critique

Adapted from critique. Use when reviewing UI/UX in plans or implemented work.

## Iron law

Evaluate against user goals and design principles — not personal taste alone.

## Review lenses

**1. AI slop detection (critical)**
- Reflex fonts, gradient text, side-stripe borders, dark+glow defaults
- Identical card grids, hero metric templates, glassmorphism decoration
- Would someone immediately say "AI made this"?

**2. User experience**
- Visual hierarchy — squint test: primary action obvious?
- Information architecture — grouping, cognitive load, progressive disclosure
- States — empty, loading, error, success all designed?
- Microcopy — clear, concise, appropriate tone?

**3. Craft**
- Typography hierarchy and readability
- Color cohesion and contrast (WCAG AA minimum)
- Spacing rhythm — varied, not monotonous
- Responsive — adapted, not amputated on small screens

**4. Spec alignment**
- Does the UI match the design brief or plan?
- Missing states or interactions? Unrequested visual scope?

## Severity

| Level | Examples |
|-------|----------|
| Critical | Unusable, inaccessible, fails spec, obvious AI slop on flagship UI |
| Important | Weak hierarchy, missing states, poor contrast, off-brand |
| Minor | Polish, microcopy tweaks, non-blocking visual refinements |

Acknowledge what works well before listing issues. Every issue needs: location, what's wrong, why it matters, what to change.
