# Design Audit (Technical)

Adapted from audit. Use when reviewing implemented UI for measurable quality issues.

## Iron law

Document verifiable issues with evidence — do not fix them in a review role.

## Check dimensions

**Accessibility**
- Contrast ratios (< 4.5:1 for body text)
- Missing labels, ARIA, focus indicators
- Semantic HTML (buttons not divs, heading hierarchy)
- Keyboard navigation and tab order

**Performance**
- Animating layout properties instead of transform/opacity
- Unoptimized images, missing lazy loading
- Unnecessary re-renders in component frameworks

**Theming**
- Hard-coded colors instead of design tokens
- Broken or missing dark mode variants
- Inconsistent token usage

**Responsive**
- Fixed widths that break on mobile
- Touch targets < 44px
- Critical functionality hidden on small screens

**Anti-patterns (grep the markup)**
- `border-left: [2-9]px` accent stripes
- `background-clip: text` with gradients
- Overused font families from the impeccable reflex list

## Output

Score each dimension 0–4 in review notes. List findings with file:line and severity. Suggest fixes for workers — do not implement.
