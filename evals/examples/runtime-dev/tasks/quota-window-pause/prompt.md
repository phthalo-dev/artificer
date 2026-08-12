`shouldPauseWindow(usedTokens, windowLimit)` in `src/quota.js` should pause
when usage reaches the window limit (inclusive). A regression made the check
exclusive (`>`), so windows stay open at exact limit. Restore inclusive
behavior. Return `false` when `windowLimit <= 0`.
