# Adapt (Responsive Design)

Adapted from adapt. Use when making UI work across screen sizes.

## Iron law

Adapt the experience for each context — do not just shrink the desktop layout.

## Process

1. **Identify constraints** — mobile touch, narrow width, slow connection?
2. **Preserve critical paths** — never hide essential actions on mobile
3. **Rethink navigation** — drawers, bottom sheets, stacked sections as needed
4. **Touch targets** — minimum ~44px interactive areas
5. **Test breakpoints** — verify at narrow (~375px) and wide viewports

## Techniques

- Mobile-first CSS where the project uses it
- Container queries for components in sidebars/cards
- Fluid spacing with `clamp()` where appropriate
- Replace hover-only affordances with visible alternatives on touch

## Report

Note which breakpoints you verified and any trade-offs (e.g., simplified table on mobile).
