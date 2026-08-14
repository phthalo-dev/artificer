`formatCost()` in `src/format.js` has a regression: amounts below one cent
display as `$0.00` instead of four decimal places. Restore the previous
behavior so `formatCost(0.0042)` returns `$0.0042`, while keeping `$0.00`
for zero and two decimals for amounts ≥ $0.01.
