/**
 * Tiny stand-in for bench report resolve-rate math.
 */
export function resolveRate(resolved, total) {
  if (total <= 0) return 0;
  return resolved / total;
}
