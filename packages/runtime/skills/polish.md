# Polish

Adapted from polish. Use for a final quality pass before marking UI work done.

## When to polish

Only after functionality works. Polish is the last step, not the first.

## Checklist

**Visual**
- Alignment to grid; consistent spacing scale
- Optical centering for icons next to text
- All interactive states: default, hover, focus, active, disabled

**Content**
- Copy consistent in tone and terminology
- Empty, loading, and error states present and helpful

**Responsive**
- Layout holds at narrow and wide breakpoints
- No horizontal scroll bugs

**Motion**
- Transitions smooth; `prefers-reduced-motion` respected if the project supports it

## Verify

Run build/lint and visually inspect critical paths. Report what you checked.
