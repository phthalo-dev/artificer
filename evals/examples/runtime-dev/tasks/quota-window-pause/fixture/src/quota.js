/**
 * Tiny stand-in for quota ledger pause logic.
 * Pause when usage reaches the window limit (inclusive).
 */
export function shouldPauseWindow(usedTokens, windowLimit) {
  if (windowLimit <= 0) return false;
  return usedTokens >= windowLimit;
}
